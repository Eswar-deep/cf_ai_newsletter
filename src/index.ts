// AI Newsletter - Cloudflare Worker
// Fetches news, summarizes with AI, and sends via email

interface Env {
	DB: D1Database;
	AI: Ai;
	NEWS_API_KEY: string;
	RESEND_API_KEY: string;
}

interface NewsArticle {
	title: string;
	description: string;
	url: string;
	publishedAt: string;
	source: { name: string };
}

/**
 * Fetch news articles for given categories
 */
async function fetchNewsForCategories(categories: string[], apiKey: string): Promise<NewsArticle[]> {
	const allArticles: NewsArticle[] = [];
	
	for (const category of categories) {
		try {
			console.log(`Fetching news for category: ${category}`);
			const url = `https://newsapi.org/v2/top-headlines?category=${category}&language=en&pageSize=5&apiKey=${apiKey}`;
			
			const response = await fetch(url);
			if (!response.ok) {
				console.error(`NewsAPI error for ${category}:`, response.status, await response.text());
				continue;
			}

			const data = await response.json() as any;
			
			if (data.status === 'ok' && data.articles) {
				console.log(`Found ${data.articles.length} articles for ${category}`);
				const categoryArticles = data.articles.map((article: any) => ({
					...article,
					category: category
				}));
				allArticles.push(...categoryArticles);
			} else {
				console.error(`NewsAPI returned error for ${category}:`, data);
			}
		} catch (error) {
			console.error(`Error fetching news for ${category}:`, error);
		}
	}
	
	console.log(`Total articles fetched: ${allArticles.length}`);
	return allArticles.slice(0, 10); // Limit to 10 articles total
}

/**
 * Summarize article using Cloudflare Workers AI (Llama 2)
 */
async function summarizeArticleWithLlama(article: NewsArticle, ai: Ai): Promise<string> {
	try {
		const prompt = `Please provide a concise summary of this news article in 2-3 sentences:

Title: ${article.title}
Description: ${article.description}

Summary:`;

		console.log(`Summarizing: ${article.title.substring(0, 50)}...`);

		const response = await ai.run('@cf/meta/llama-2-7b-chat-int8', {
			messages: [
				{ role: 'user', content: prompt }
			],
			max_tokens: 150,
			temperature: 0.7
		}) as any;

		if (response && response.response) {
			const summary = response.response.trim();
			console.log(`AI Summary generated (${summary.length} chars)`);
			return summary;
		} else {
			console.log('AI response was empty, using fallback');
			return createFallbackSummary(article);
		}
	} catch (error) {
		console.error('Error with AI summarization:', error);
		return createFallbackSummary(article);
	}
}

/**
 * Create fallback summary when AI fails
 */
function createFallbackSummary(article: NewsArticle): string {
	const description = article.description || article.title;
	return description.length > 200 ? description.substring(0, 197) + '...' : description;
}

/**
 * Handle user subscription
 */
async function handleSubscribe(request: Request, env: Env): Promise<Response> {
	try {
		const formData = await request.formData();
		const email = formData.get('email') as string;
		const selectedCategories = formData.getAll('categories') as string[];

		if (!email || selectedCategories.length === 0) {
			return new Response('Email and at least one category are required', { status: 400 });
		}

		// Store in database
		const categoriesString = selectedCategories.join(',');
		
		try {
			await env.DB.prepare(
				'INSERT INTO users (email, categories) VALUES (?, ?) ON CONFLICT(email) DO UPDATE SET categories = ?, active = 1'
			).bind(email, categoriesString, categoriesString).run();

			console.log(`Subscription processed for ${email} with categories: ${categoriesString}`);

			return new Response(`
				<!DOCTYPE html>
				<html>
				<head>
					<title>Subscription Successful</title>
					<style>
						body { font-family: Arial, sans-serif; max-width: 600px; margin: 50px auto; padding: 20px; text-align: center; }
						.success { background: #d4edda; border: 1px solid #c3e6cb; color: #155724; padding: 15px; border-radius: 5px; margin: 20px 0; }
					</style>
				</head>
				<body>
					<h1>🎉 Subscription Successful!</h1>
					<div class="success">
						<p>Thank you for subscribing to our AI Newsletter!</p>
						<p><strong>Email:</strong> ${email}</p>
						<p><strong>Categories:</strong> ${selectedCategories.join(', ')}</p>
						<p>You'll receive your first newsletter at the next scheduled time.</p>
					</div>
					<a href="/" style="color: #007bff; text-decoration: none;">← Subscribe Another Email</a>
				</body>
				</html>
			`, {
				headers: { 'Content-Type': 'text/html' }
			});
		} catch (dbError) {
			console.error('Database error:', dbError);
			return new Response('Database error occurred', { status: 500 });
		}
	} catch (error) {
		console.error('Subscription error:', error);
		return new Response('Subscription failed', { status: 500 });
	}
}

/**
 * Process newsletter for a single user
 */
async function processUserNewsletter(user: any, env: Env): Promise<void> {
	try {
		const { email, categories } = user;
		const categoryList = categories.split(',').map((c: string) => c.trim());
		
		console.log(`Processing newsletter for ${email} with categories: ${categoryList.join(', ')}`);

		// Fetch news articles
		const articles = await fetchNewsForCategories(categoryList, env.NEWS_API_KEY);
		
		if (articles.length === 0) {
			console.log(`No articles found for ${email}`);
			return;
		}

		// Generate summaries using AI
		const summaries = [];
		for (const article of articles) {
			const summary = await summarizeArticleWithLlama(article, env.AI);
			summaries.push({
				article,
				summary,
				category: (article as any).category || 'general'
			});
		}

		// Generate and format the newsletter
		const newsletter = formatNewsletter(email, summaries);
		
		// Send the newsletter via Resend
		const subject = `🤖 Your AI Newsletter - ${new Date().toDateString()}`;
		const emailSent = await sendEmailWithResend(
			email, 
			subject, 
			newsletter,
			env
		);
		
		if (emailSent) {
			console.log(`✅ Newsletter sent successfully to ${email}`);
		} else {
			console.log(`❌ Failed to send newsletter to ${email}`);
		}
		
	} catch (error) {
		console.error(`Error processing newsletter for user:`, error);
	}
}

/**
 * Format the newsletter content
 */
function formatNewsletter(email: string, summaries: { article: NewsArticle; summary: string; category: string }[]): string {
	const date = new Date().toDateString();
	
	let newsletter = `🤖 Your AI Newsletter - ${date}\n\n`;
	newsletter += `Hello! Here's your personalized news digest:\n\n`;
	
	// Group by category
	const byCategory: { [key: string]: typeof summaries } = {};
	summaries.forEach(item => {
		if (!byCategory[item.category]) {
			byCategory[item.category] = [];
		}
		byCategory[item.category].push(item);
	});
	
	// Format each category
	Object.keys(byCategory).forEach(category => {
		newsletter += `📰 ${category.toUpperCase()}\n`;
		newsletter += '─'.repeat(40) + '\n\n';
		
		byCategory[category].forEach((item, index) => {
			newsletter += `${index + 1}. **${item.article.title}**\n`;
			newsletter += `   ${item.summary}\n`;
			newsletter += `   Source: ${item.article.source.name}\n`;
			newsletter += `   Read more: ${item.article.url}\n\n`;
		});
	});
	
	newsletter += `\n───────────────────────────────\n`;
	newsletter += `Generated with ❤️ by AI Newsletter\n`;
	newsletter += `Powered by Cloudflare Workers & Resend\n`;
	
	return newsletter;
}

/**
 * Send email using Resend API
 */
async function sendEmailWithResend(
	to: string, 
	subject: string, 
	content: string,
	env: any,
	fromEmail: string = 'newsletter@resend.dev',
	fromName: string = 'AI Newsletter'
): Promise<boolean> {
	try {
		console.log(`📧 Sending email via Resend to: ${to}`);
		console.log(`📧 Subject: ${subject}`);
		console.log(`📧 From: ${fromName} <${fromEmail}>`);
		
		// Check if we have the Resend API key
		if (!env.RESEND_API_KEY) {
			console.log(`❌ RESEND_API_KEY not found in environment`);
			return false;
		}
		
		// Use Resend API for reliable email delivery
		const emailPayload = {
			from: `${fromName} <${fromEmail}>`,
			to: [to],
			subject: subject,
			html: `<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${subject}</title>
</head>
<body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
    <div style="background: #f8f9fa; padding: 20px; border-radius: 8px; margin-bottom: 20px;">
        <h1 style="color: #2c3e50; margin: 0;">🤖 AI Newsletter</h1>
        <p style="color: #7f8c8d; margin: 5px 0 0 0;">Your daily AI-curated news digest</p>
    </div>
    
    <div style="white-space: pre-line; background: white; padding: 20px; border-radius: 8px; border-left: 4px solid #3498db;">
        ${content.replace(/\n/g, '<br>').replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')}
    </div>
    
    <div style="margin-top: 30px; padding-top: 20px; border-top: 1px solid #eee; text-align: center; color: #7f8c8d; font-size: 12px;">
        <p>You received this because you subscribed to AI Newsletter</p>
        <p>Powered by Cloudflare Workers & Resend</p>
    </div>
</body>
</html>`,
			text: content
		};

		const resendResponse = await fetch('https://api.resend.com/emails', {
			method: 'POST',
			headers: {
				'Authorization': `Bearer ${env.RESEND_API_KEY}`,
				'Content-Type': 'application/json',
			},
			body: JSON.stringify(emailPayload)
		});

		if (!resendResponse.ok) {
			const errorText = await resendResponse.text();
			console.error('Resend API error:', resendResponse.status, errorText);
			return false;
		}

		const responseData = await resendResponse.json();
		console.log('Resend response:', responseData);
		console.log(`✅ Email sent successfully to ${to} via Resend!`);
		return true;

	} catch (error) {
		console.error('Error sending email via Resend:', error);
		return false;
	}
}

// HTML content for the subscription page
const HTML_CONTENT = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>AI Newsletter Subscription</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { 
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 20px;
        }
        .container {
            background: white;
            padding: 40px;
            border-radius: 15px;
            box-shadow: 0 15px 35px rgba(0, 0, 0, 0.1);
            max-width: 500px;
            width: 100%;
        }
        .header {
            text-align: center;
            margin-bottom: 30px;
        }
        .header h1 {
            color: #333;
            font-size: 28px;
            margin-bottom: 10px;
        }
        .header p {
            color: #666;
            font-size: 16px;
        }
        .form-group {
            margin-bottom: 25px;
        }
        label {
            display: block;
            margin-bottom: 8px;
            color: #333;
            font-weight: 600;
        }
        input[type="email"] {
            width: 100%;
            padding: 12px;
            border: 2px solid #e1e5e9;
            border-radius: 8px;
            font-size: 16px;
            transition: border-color 0.3s;
        }
        input[type="email"]:focus {
            outline: none;
            border-color: #667eea;
        }
        .categories {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
            gap: 10px;
        }
        .category-item {
            display: flex;
            align-items: center;
            padding: 10px;
            border: 2px solid #e1e5e9;
            border-radius: 8px;
            cursor: pointer;
            transition: all 0.3s;
        }
        .category-item:hover {
            border-color: #667eea;
            background-color: #f8f9ff;
        }
        .category-item input[type="checkbox"] {
            margin-right: 10px;
            width: 18px;
            height: 18px;
            accent-color: #667eea;
        }
        .category-item input[type="checkbox"]:checked + .category-label {
            color: #667eea;
            font-weight: 600;
        }
        .category-item:has(input:checked) {
            border-color: #667eea;
            background-color: #f8f9ff;
        }
        .submit-btn {
            width: 100%;
            padding: 15px;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            border: none;
            border-radius: 8px;
            font-size: 16px;
            font-weight: 600;
            cursor: pointer;
            transition: transform 0.2s;
        }
        .submit-btn:hover {
            transform: translateY(-2px);
        }
        .submit-btn:active {
            transform: translateY(0);
        }
        .footer {
            text-align: center;
            margin-top: 30px;
            color: #666;
            font-size: 14px;
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>🤖 AI Newsletter</h1>
            <p>Get AI-curated news delivered to your inbox</p>
        </div>

        <form action="/api/subscribe" method="POST">
            <div class="form-group">
                <label for="email">Email Address</label>
                <input type="email" id="email" name="email" required placeholder="your.email@example.com">
            </div>

            <div class="form-group">
                <label>Select News Categories</label>
                <div class="categories">
                    <div class="category-item">
                        <input type="checkbox" id="technology" name="categories" value="technology">
                        <label for="technology" class="category-label">📱 Technology</label>
                    </div>
                    <div class="category-item">
                        <input type="checkbox" id="business" name="categories" value="business">
                        <label for="business" class="category-label">💼 Business</label>
                    </div>
                    <div class="category-item">
                        <input type="checkbox" id="science" name="categories" value="science">
                        <label for="science" class="category-label">🧪 Science</label>
                    </div>
                    <div class="category-item">
                        <input type="checkbox" id="health" name="categories" value="health">
                        <label for="health" class="category-label">🏥 Health</label>
                    </div>
                    <div class="category-item">
                        <input type="checkbox" id="sports" name="categories" value="sports">
                        <label for="sports" class="category-label">⚽ Sports</label>
                    </div>
                    <div class="category-item">
                        <input type="checkbox" id="entertainment" name="categories" value="entertainment">
                        <label for="entertainment" class="category-label">🎬 Entertainment</label>
                    </div>
                    <div class="category-item">
                        <input type="checkbox" id="general" name="categories" value="general">
                        <label for="general" class="category-label">📰 General News</label>
                    </div>
                </div>
            </div>

            <button type="submit" class="submit-btn">Subscribe to Newsletter</button>
        </form>

        <div class="footer">
            <p>Powered by Cloudflare Workers & AI</p>
        </div>
    </div>
</body>
</html>`;

// Main worker export
export default {
	// Handle HTTP requests
	async fetch(request: Request, env: Env): Promise<Response> {
		const url = new URL(request.url);
		console.log(`[FETCH] ${request.method} ${url.pathname}`);

		// Handle API routes
		if (url.pathname.startsWith('/api/')) {
			console.log('[FETCH] Handling API route');
			
			// Handle subscription
			if (url.pathname === '/api/subscribe' && request.method === 'POST') {
				console.log('[FETCH] Processing subscription');
				return await handleSubscribe(request, env);
			}
			
			// Fallback for other API routes
			return new Response('API Route Not Found', { status: 404 });
		}

		// For the root path, serve the HTML file
		if (url.pathname === '/') {
			console.log('[FETCH] Serving HTML content');
			return new Response(HTML_CONTENT, {
				headers: { 'Content-Type': 'text/html' }
			});
		}

		// For any other request, return a 404
		console.log('[FETCH] Returning 404');
		return new Response('Not Found', { status: 404 });
	},

	// Handle scheduled events (cron jobs)
	async scheduled(controller: ScheduledController, env: Env): Promise<void> {
		console.log('🕒 Cron job triggered at:', new Date().toISOString());
		
		try {
			// Get all active subscribers
			const { results } = await env.DB.prepare('SELECT * FROM users WHERE active = 1').all();
			
			if (!results || results.length === 0) {
				console.log('No active subscribers found');
				return;
			}

			console.log(`Processing newsletters for ${results.length} subscribers`);
			
			// Process each subscriber
			for (const user of results) {
				await processUserNewsletter(user, env);
			}
			
			console.log('✅ Cron job completed successfully');
		} catch (error) {
			console.error('❌ Cron job failed:', error);
		}
	},
};