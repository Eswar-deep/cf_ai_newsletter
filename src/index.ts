/**
 * This is the main entrypoint for our Cloudflare Worker.
 * It will handle API requests for subscribing users and will eventually
 * be triggered by a cron job to send the daily briefing.
 */
import type { D1Database, ExecutionContext, ScheduledEvent } from '@cloudflare/workers-types';

export interface Env {
	// This binding gives us access to our D1 database.
	DB: D1Database;
	// This binding gives us access to Workers AI
	AI: Ai;
	// This is a secret we will set to store our NewsAPI key.
	NEWS_API_KEY: string;
	// Optional: LLM API key if using external service
	LLM_API_KEY?: string;

	// We will add more bindings for secrets and other services later.
}

interface SubscriptionRequest {
	email: string;
	categories: string[];
}

interface NewsArticle {
	title: string;
	description: string;
	content: string;
	url: string;
	source: {
		name: string;
	};
	publishedAt: string;
}

interface NewsAPIResponse {
	articles: NewsArticle[];
	totalResults: number;
}

/**
 * Fetches news articles from NewsAPI for the given categories
 */
async function fetchNewsForCategories(categories: string[], apiKey: string): Promise<NewsArticle[]> {
	const allArticles: NewsArticle[] = [];
	
	for (const category of categories) {
		try {
		console.log(`🔍 Fetching news for category: ${category}`);
		
		// NewsAPI endpoint for top headlines by category
		const url = `https://newsapi.org/v2/top-headlines?category=${category}&country=us&pageSize=5&apiKey=${apiKey}`;
		
		console.log(`📡 Making request to: ${url.replace(apiKey, 'API_KEY_HIDDEN')}`);
		console.log(`🔑 Using API key: ${apiKey.substring(0, 8)}...${apiKey.substring(apiKey.length - 4)}`);
		
		const response = await fetch(url, {
			headers: {
				'User-Agent': 'CF-AI-Newsletter/1.0 (Cloudflare Worker)'
			}
		});
		console.log(`Response status: ${response.status} ${response.statusText}`);		if (!response.ok) {
			const errorText = await response.text();
			console.error(`❌ Failed to fetch news for ${category}:`, response.status, errorText);
			console.error(`❌ Full error response:`, errorText);
			continue;
		}
		
		const data = await response.json() as NewsAPIResponse;
		console.log(`📊 Found ${data.articles?.length || 0} articles for ${category}`);
		console.log(`📊 Total results available: ${data.totalResults || 'unknown'}`);
		console.log(`📋 Raw API response for ${category}:`, JSON.stringify(data, null, 2));			if (!data.articles || data.articles.length === 0) {
				console.log(`No articles returned for ${category}`);
				continue;
			}
			
			// Add category info to articles and filter out articles without content
			const categoryArticles = data.articles
				.filter(article => {
					const hasContent = article.content && article.content !== '[Removed]';
					if (!hasContent) {
						console.log(`Skipping article without content: ${article.title}`);
					}
					return hasContent;
				})
				.map(article => ({
					...article,
					category: category
				}));
			
			console.log(`Filtered to ${categoryArticles.length} articles with content for ${category}`);
			allArticles.push(...categoryArticles);
		} catch (error) {
			console.error(`Error fetching news for category ${category}:`, error);
		}
	}
	
	return allArticles;
}

/**
 * Uses external LLM API to summarize a news article
 */
/**
 * Uses Workers AI with Llama 2 to summarize a news article
 */
async function summarizeArticleWithLlama(article: NewsArticle, ai: Ai): Promise<string> {
	try {
		console.log(`🤖 Summarizing article with Llama 2: ${article.title}`);
		
		// Create a prompt with the article content
		const articleContent = article.content || article.description || 'No content available';
		const prompt = `Summarize this news article in exactly 1-2 clear, concise sentences. Focus on the main facts and key information.

Title: ${article.title}
Content: ${articleContent.substring(0, 1000)}...
Source: ${article.source.name}

Summary:`;

		// Use Workers AI with a reliable Llama model
		const modelName = '@cf/meta/llama-2-7b-chat-int8';
		const response = await ai.run(modelName as any, {
			prompt: `${prompt}\n\nAssistant: Here's a concise summary:`
		}) as any;

		// Handle the response properly - Workers AI returns response in different formats
		let summary: string;
		if (typeof response === 'string') {
			summary = response.trim();
		} else if (response && typeof response === 'object' && 'response' in response) {
			summary = (response as any).response?.trim();
		} else {
			summary = `${article.title}: Summary not available`;
		}
		
		console.log(`✅ Generated summary: ${summary.substring(0, 100)}...`);
		return summary;
		
	} catch (error) {
		console.error(`❌ Error summarizing article "${article.title}":`, error);
		
		// Fallback to a simple but intelligent summary
		const fallbackSummary = createFallbackSummary(article);
		console.log(`🔄 Using fallback summary: ${fallbackSummary.substring(0, 100)}...`);
		return fallbackSummary;
	}
}

/**
 * Creates a fallback summary when AI is unavailable
 */
function createFallbackSummary(article: NewsArticle): string {
	const description = article.description || '';
	const content = article.content || '';
	
	// Try to create a smart summary from available content
	if (description && description.length > 10 && description !== '[Removed]') {
		// Use the description if it's meaningful
		return `${article.source.name} reports: ${description}`;
	} else if (content && content.length > 50) {
		// Extract first meaningful sentence from content
		const sentences = content.split(/[.!?]+/);
		const firstSentence = sentences[0]?.trim();
		if (firstSentence && firstSentence.length > 20) {
			return `${article.source.name}: ${firstSentence}.`;
		}
	}
	
	// Last resort: use title with source
	return `${article.source.name}: ${article.title}`;
}

/**
 * Test NewsAPI integration
 */
async function testNewsAPI(request: Request, env: Env): Promise<Response> {
	try {
		// Get API key from request body or use environment variable
		const body = await request.json().catch(() => ({})) as any;
		const apiKey = body.apiKey || env.NEWS_API_KEY;
		
		if (!apiKey) {
			return Response.json({ 
				message: 'NewsAPI key is required. Send it in the request body as {"apiKey": "your-key"} or set NEWS_API_KEY environment variable.',
				example: {
					method: 'POST',
					body: '{"apiKey": "your-newsapi-key", "categories": ["technology", "science"]}'
				}
			}, { status: 400 });
		}

		// Test categories from request or use defaults
		const categories = body.categories || ['technology', 'science'];
		
		console.log(`Testing NewsAPI with categories: ${categories.join(', ')}`);
		console.log(`API Key provided: ${apiKey.substring(0, 8)}...${apiKey.substring(apiKey.length - 4)}`);
		
		// Fetch news articles
		const articles = await fetchNewsForCategories(categories, apiKey);
		
		console.log(`Total articles fetched: ${articles.length}`);
		
		if (articles.length === 0) {
			return Response.json({ 
				message: 'No articles found. This could mean:',
				possibleCauses: [
					'Invalid API key - check if your NewsAPI key is correct',
					'API rate limit exceeded - free tier allows 100 requests/day',
					'No articles available for the selected categories today',
					'Network connectivity issue',
					'NewsAPI service temporarily unavailable'
				],
				categories: categories,
				debugging: {
					apiKeyFormat: `${apiKey.substring(0, 8)}...${apiKey.substring(apiKey.length - 4)}`,
					timestamp: new Date().toISOString()
				}
			}, { status: 404 });
		}

		// Generate summaries for the articles
		const summaries = [];
		for (const article of articles.slice(0, 5)) { // Limit to 5 for testing
			const summary = await summarizeArticleWithLlama(article, env.AI);
			summaries.push({
				title: article.title,
				summary: summary,
				url: article.url,
				source: article.source.name,
				category: (article as any).category || 'general'
			});
		}

		return Response.json({ 
			message: `Successfully fetched ${articles.length} articles from NewsAPI!`,
			categories: categories,
			articlesFound: articles.length,
			sampleSummaries: summaries,
			testSuccess: true
		});
		
	} catch (error) {
		console.error('NewsAPI test failed:', error);
		return Response.json({ 
			message: 'NewsAPI test failed',
			error: error instanceof Error ? error.message : String(error)
		}, { status: 500 });
	}
}

async function handleSubscribe(request: Request, env: Env): Promise<Response> {
	console.log('handleSubscribe called');
	
	try {
		const body = await request.json();
		console.log('Request body:', body);
		
		const { email, categories } = body as SubscriptionRequest;

		// Basic validation
		if (!email || !Array.isArray(categories) || categories.length === 0) {
			console.log('Validation failed');
			return Response.json({ message: 'Invalid input: email and at least one category are required.' }, { status: 400 });
		}

		// Validate email format
		const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
		if (!emailRegex.test(email)) {
			console.log('Email format invalid');
			return Response.json({ message: 'Invalid email format.' }, { status: 400 });
		}

		console.log(`Attempting to save subscription for email: ${email}`);
		
		const categoriesJson = JSON.stringify(categories);

		// Use an "upsert" query:
		// - If the email doesn't exist, it inserts a new row.
		// - If the email already exists, it updates the categories for that user.
		const stmt = env.DB.prepare(
			'INSERT INTO users (email, categories) VALUES (?1, ?2) ON CONFLICT(email) DO UPDATE SET categories = ?2'
		);
		
		const result = await stmt.bind(email, categoriesJson).run();
		console.log('Database operation result:', result);

		if (result.success) {
			return Response.json({ message: 'Configuration saved successfully!' }, { status: 200 });
		} else {
			console.error('Database operation failed:', result.error);
			return Response.json({ message: 'Database operation failed.' }, { status: 500 });
		}
	} catch (e) {
		console.error('Error in handleSubscribe:', e);
		// If the request body isn't valid JSON, this will catch it.
		if (e instanceof SyntaxError) {
			return Response.json({ message: 'Invalid JSON in request body.' }, { status: 400 });
		}
		// Handle any other database or runtime errors
		return Response.json({ message: 'An internal server error occurred.' }, { status: 500 });
	}
}

// HTML content for the main page
const HTML_CONTENT = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Personalized Daily Briefing Agent</title>
    <style>
        body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; max-width: 600px; margin: 2rem auto; padding: 0 1rem; color: #333; }
        h1 { color: #111; }
        form { display: flex; flex-direction: column; gap: 1.25rem; background-color: #f9f9f9; padding: 1.5rem; border-radius: 8px; border: 1px solid #eee;}
        label { font-weight: bold; }
        input[type="email"] { padding: 0.5rem; border: 1px solid #ccc; border-radius: 4px; width: 100%; box-sizing: border-box; }
        .categories { display: grid; grid-template-columns: repeat(auto-fit, minmax(120px, 1fr)); gap: 0.75rem; }
        .category-item { display: flex; align-items: center; gap: 0.5rem; }
        button { padding: 0.75rem; background-color: #007bff; color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 1rem; transition: background-color 0.2s; }
        button:hover { background-color: #0056b3; }
        button:disabled { background-color: #aaa; cursor: not-allowed; }
        #message { margin-top: 1rem; padding: 1rem; border-radius: 4px; display: none; text-align: center; }
        .success { background-color: #d4edda; color: #155724; border: 1px solid #c3e6cb; }
        .error { background-color: #f8d7da; color: #721c24; border: 1px solid #f5c6cb; }
    </style>
</head>
<body>
    <h1>Configure Your Daily Briefing</h1>
    <p>Enter your email and select the news categories you're interested in.</p>

    <form id="config-form">
        <div>
            <label for="email">Email Address:</label>
            <input type="email" id="email" name="email" required>
        </div>

        <div>
            <label>News Categories:</label>
            <div class="categories">
                <div class="category-item"><input type="checkbox" id="business" name="category" value="business"><label for="business">Business</label></div>
                <div class="category-item"><input type="checkbox" id="entertainment" name="category" value="entertainment"><label for="entertainment">Entertainment</label></div>
                <div class="category-item"><input type="checkbox" id="general" name="category" value="general"><label for="general">General</label></div>
                <div class="category-item"><input type="checkbox" id="health" name="category" value="health"><label for="health">Health</label></div>
                <div class="category-item"><input type="checkbox" id="science" name="category" value="science"><label for="science">Science</label></div>
                <div class="category-item"><input type="checkbox" id="sports" name="category" value="sports"><label for="sports">Sports</label></div>
                <div class="category-item"><input type="checkbox" id="technology" name="category" value="technology"><label for="technology">Technology</label></div>
            </div>
        </div>

        <button type="submit" id="submit-btn">Save Configuration</button>
    </form>

    <div id="message"></div>
    
    <!-- NewsAPI Test Section -->
    <div style="margin-top: 2rem; padding: 1.5rem; background-color: #f0f8ff; border-radius: 8px; border: 1px solid #add8e6;">
        <h2>🧪 Test NewsAPI Integration</h2>
        <p>Test your NewsAPI key and see live news articles:</p>
        <form id="news-test-form">
            <div style="margin-bottom: 1rem;">
                <label for="api-key">NewsAPI Key:</label>
                <input type="text" id="api-key" placeholder="Enter your NewsAPI key" style="width: 100%; padding: 0.5rem; margin-top: 0.5rem;" value="65833a57006a47fbb61a092994a1df3c">
            </div>
            <button type="submit" id="test-btn">Test NewsAPI</button>
        </form>
        <div id="news-results" style="margin-top: 1rem; display: none; padding: 1rem; background-color: #fff; border-radius: 4px; max-height: 400px; overflow-y: auto;"></div>
    </div>

    <script>
        const form = document.getElementById('config-form');
        const messageDiv = document.getElementById('message');
        const submitBtn = document.getElementById('submit-btn');

        form.addEventListener('submit', async (event) => {
            event.preventDefault();
            submitBtn.disabled = true;
            submitBtn.textContent = 'Saving...';

            const email = form.email.value;
            const selectedCategories = Array.from(form.querySelectorAll('input[name="category"]:checked')).map(cb => cb.value);

            if (selectedCategories.length === 0) {
                showMessage('Please select at least one category.', 'error');
                submitBtn.disabled = false;
                submitBtn.textContent = 'Save Configuration';
                return;
            }

            try {
                const response = await fetch('/api/subscribe', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ email, categories: selectedCategories }),
                });

                console.log('Response status:', response.status);
                console.log('Response ok:', response.ok);

                if (!response.ok) {
                    throw new Error(\`HTTP error! status: \${response.status}\`);
                }

                const result = await response.json();
                console.log('Response data:', result);
                showMessage(result.message, response.ok ? 'success' : 'error');

            } catch (err) {
                console.error('Fetch error:', err);
                showMessage(\`An unexpected error occurred: \${err.message}\`, 'error');
            } finally {
                submitBtn.disabled = false;
                submitBtn.textContent = 'Save Configuration';
            }
        });

        function showMessage(text, type) {
            messageDiv.textContent = text;
            messageDiv.className = type;
            messageDiv.style.display = 'block';
        }

        // NewsAPI Test Form Handler
        const newsTestForm = document.getElementById('news-test-form');
        const newsResults = document.getElementById('news-results');
        const testBtn = document.getElementById('test-btn');

        newsTestForm.addEventListener('submit', async (event) => {
            event.preventDefault();
            testBtn.disabled = true;
            testBtn.textContent = 'Testing...';
            newsResults.style.display = 'none';

            const apiKey = document.getElementById('api-key').value;
            
            if (!apiKey) {
                showNewsResults('Please enter your NewsAPI key', 'error');
                testBtn.disabled = false;
                testBtn.textContent = 'Test NewsAPI';
                return;
            }

            try {
                const response = await fetch('/api/test-news', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ 
                        apiKey: apiKey,
                        categories: ['technology', 'science']
                    }),
                });

                const result = await response.json();
                
                if (response.ok) {
                    showNewsResults(formatNewsResults(result), 'success');
                } else {
                    showNewsResults(result.message || 'Test failed', 'error');
                }

            } catch (err) {
                showNewsResults(\`Error testing NewsAPI: \${err.message}\`, 'error');
            } finally {
                testBtn.disabled = false;
                testBtn.textContent = 'Test NewsAPI';
            }
        });

        function showNewsResults(content, type) {
            newsResults.innerHTML = content;
            newsResults.className = type;
            newsResults.style.display = 'block';
        }

        function formatNewsResults(result) {
            let html = \`<h3>✅ Success! Found \${result.articlesFound} articles</h3>\`;
            html += \`<p><strong>Categories tested:</strong> \${result.categories.join(', ')}</p>\`;
            
            if (result.sampleSummaries && result.sampleSummaries.length > 0) {
                html += \`<h4>📰 Sample Articles:</h4>\`;
                result.sampleSummaries.forEach((item, index) => {
                    html += \`
                        <div style="margin: 1rem 0; padding: 1rem; border-left: 3px solid #007bff; background-color: #f8f9fa;">
                            <strong>\${index + 1}. \${item.title}</strong><br>
                            <em>Source: \${item.source} | Category: \${item.category}</em><br>
                            <p style="margin: 0.5rem 0;">\${item.summary}</p>
                            <a href="\${item.url}" target="_blank" style="color: #007bff;">Read full article →</a>
                        </div>
                    \`;
                });
            }
            
            return html;
        }
    </script>
</body>
</html>`;

// The main fetch handler, which uses the router to handle incoming requests.
// The .all('*', ...) route is a catch-all that returns a 404 for any
// API route that doesn't match.
export default {
	/**
	 * The main fetch handler. We wrap the router in a try/catch block to ensure
	 * that we always return a response, even if the router encounters an error.
	 * This prevents the "The script will never generate a response" error.
	 */
	async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
		console.log(`[FETCH] ${request.method} ${request.url}`);
		const url = new URL(request.url);
		console.log(`[FETCH] Pathname: ${url.pathname}`);
		
		// Handle API routes
		if (url.pathname.startsWith('/api/')) {
			console.log('[FETCH] Handling API route');
			
			// Handle the subscribe route directly
			if (url.pathname === '/api/subscribe' && request.method === 'POST') {
				console.log('[FETCH] Handling subscribe route directly');
				return await handleSubscribe(request, env);
			}
			
			// Simple test endpoint
			if (url.pathname === '/api/hello' && request.method === 'GET') {
				console.log('[FETCH] Hello endpoint called');
				return Response.json({ message: 'Hello! Server is working!', timestamp: new Date().toISOString() });
			}
			
			// Test NewsAPI endpoint
			if (url.pathname === '/api/test-news' && request.method === 'POST') {
				console.log('[FETCH] Testing NewsAPI integration');
				return await testNewsAPI(request, env);
			}
			
			// Test endpoint to manually trigger newsletter generation
			if (url.pathname === '/api/test-newsletter' && request.method === 'POST') {
				console.log('[FETCH] Testing newsletter generation');
				return await testNewsletterGeneration(env);
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

	/**
	 * This is the scheduled handler, which will be executed by the cron trigger.
	 */
	async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
		console.log(`Cron trigger fired at ${new Date(event.scheduledTime)}. Time to build the newsletter.`);
		
		try {
			// Check if we have the required API key
			if (!env.NEWS_API_KEY) {
				console.error('NEWS_API_KEY is not set in environment variables');
				return;
			}

			// Fetch all users from the database
			console.log('Fetching all users from database...');
			const usersResult = await env.DB.prepare('SELECT email, categories FROM users').all();
			
			if (!usersResult.success) {
				console.error('Failed to fetch users from database');
				return;
			}

			const users = usersResult.results;
			console.log(`Found ${users.length} users to process`);

			// Process each user
			for (const user of users) {
				await processUserNewsletter(user, env);
			}

			console.log('Newsletter processing completed successfully');
		} catch (error) {
			console.error('Error in scheduled newsletter processing:', error);
		}
	},
};

/**
 * Processes newsletter generation for a single user
 */
async function processUserNewsletter(user: any, env: Env): Promise<void> {
	try {
		const email = user.email as string;
		const categories = JSON.parse(user.categories as string) as string[];
		
		console.log(`Processing newsletter for ${email} with categories: ${categories.join(', ')}`);

		// Fetch news articles for user's categories
		const articles = await fetchNewsForCategories(categories, env.NEWS_API_KEY);
		
		if (articles.length === 0) {
			console.log(`No articles found for ${email}`);
			return;
		}

		console.log(`Found ${articles.length} articles for ${email}`);

		// Summarize each article using external LLM
		const summaries: { article: NewsArticle; summary: string; category: string }[] = [];
		
		for (const article of articles.slice(0, 10)) { // Limit to 10 articles per user
			const summary = await summarizeArticleWithLlama(article, env.AI);
			summaries.push({
				article,
				summary,
				category: (article as any).category || 'general'
			});
		}

		// Generate and format the newsletter
		const newsletter = formatNewsletter(email, summaries);
		
		// For now, just log the newsletter (in next steps, you would email it)
		console.log(`Newsletter generated for ${email}:`);
		console.log(newsletter);
		console.log('--- End of Newsletter ---\n');

	} catch (error) {
		console.error(`Error processing newsletter for user:`, error);
	}
}

/**
 * Formats the newsletter with summaries organized by category
 */
function formatNewsletter(email: string, summaries: { article: NewsArticle; summary: string; category: string }[]): string {
	const date = new Date().toDateString();
	
	// Group summaries by category
	const categorizedSummaries: { [category: string]: { article: NewsArticle; summary: string }[] } = {};
	
	for (const item of summaries) {
		if (!categorizedSummaries[item.category]) {
			categorizedSummaries[item.category] = [];
		}
		categorizedSummaries[item.category].push({
			article: item.article,
			summary: item.summary
		});
	}

	let newsletter = `🗞️ Your Daily AI-Powered News Briefing - ${date}\n`;
	newsletter += `📧 For: ${email}\n\n`;

	// Add summaries organized by category
	for (const [category, items] of Object.entries(categorizedSummaries)) {
		newsletter += `📂 ${category.toUpperCase()}\n`;
		newsletter += `${'='.repeat(category.length + 2)}\n\n`;

		for (let i = 0; i < items.length; i++) {
			const { article, summary } = items[i];
			newsletter += `${i + 1}. ${article.title}\n`;
			newsletter += `   🤖 AI Summary: ${summary}\n`;
			newsletter += `   🔗 Read more: ${article.url}\n`;
			newsletter += `   📰 Source: ${article.source.name}\n\n`;
		}
	}

	newsletter += `\n📝 This newsletter was generated using Cloudflare Workers AI\n`;
	newsletter += `⚙️ Powered by NewsAPI and Llama 3 AI\n`;

	return newsletter;
}

/**
 * Test endpoint to manually trigger newsletter generation
 */
async function testNewsletterGeneration(env: Env): Promise<Response> {
	try {
		// For testing, we'll use a mock API key or check for environment variable
		const testApiKey = env.NEWS_API_KEY || 'test-api-key';
		
		// Fetch one user from database
		const usersResult = await env.DB.prepare('SELECT email, categories FROM users LIMIT 1').all();
		
		if (!usersResult.success || usersResult.results.length === 0) {
			return Response.json({ 
				message: 'No users found in database. Please subscribe first using the form.' 
			}, { status: 404 });
		}

		const user = usersResult.results[0];
		const email = user.email as string;
		const categories = JSON.parse(user.categories as string) as string[];

		// If we don't have a real API key, simulate with mock data
		if (!env.NEWS_API_KEY) {
			return await testWithMockData(email, categories, env);
		}

		// Process newsletter for the test user
		await processUserNewsletter(user, env);
		
		return Response.json({ 
			message: `Newsletter generated successfully for ${email}. Check the console logs for the output.`,
			categories: categories
		});
		
	} catch (error) {
		console.error('Error in test newsletter generation:', error);
		return Response.json({ 
			message: 'Error generating test newsletter',
			error: error instanceof Error ? error.message : String(error)
		}, { status: 500 });
	}
}

/**
 * Test with mock data when no real API key is available
 */
async function testWithMockData(email: string, categories: string[], env: Env): Promise<Response> {
	try {
		// Create mock articles
		const mockArticles: NewsArticle[] = [
			{
				title: "AI Technology Breakthrough in 2025",
				description: "Researchers announce major advancement in artificial intelligence capabilities with new transformer architecture.",
				content: "Scientists at leading research institutions have developed a new AI architecture that shows significant improvements in reasoning and understanding. The breakthrough could revolutionize how we interact with AI systems.",
				url: "https://example.com/ai-breakthrough",
				source: { name: "Tech News Daily" },
				publishedAt: new Date().toISOString()
			},
			{
				title: "Climate Change Solutions Show Promise",
				description: "New renewable energy technology could help reduce carbon emissions by 50% over the next decade.",
				content: "A consortium of environmental scientists has developed innovative solar panel technology that is both more efficient and cheaper to produce than current methods.",
				url: "https://example.com/climate-solution",
				source: { name: "Environmental Report" },
				publishedAt: new Date().toISOString()
			}
		];

		// Summarize each article using AI
		const summaries: { article: NewsArticle; summary: string; category: string }[] = [];
		
		for (let i = 0; i < mockArticles.length; i++) {
			const article = mockArticles[i];
			const category = categories[i % categories.length]; // Cycle through user's categories
			
			const summary = await summarizeArticleWithLlama(article, env.AI);
			summaries.push({
				article,
				summary,
				category
			});
		}

		// Generate newsletter
		const newsletter = formatNewsletter(email, summaries);
		
		console.log(`TEST NEWSLETTER GENERATED:`);
		console.log(newsletter);
		
		return Response.json({ 
			message: `Test newsletter generated successfully for ${email}!`,
			newsletter: newsletter,
			articlesProcessed: mockArticles.length
		});
		
	} catch (error) {
		console.error('Error in mock newsletter generation:', error);
		return Response.json({ 
			message: 'Error generating mock newsletter',
			error: error instanceof Error ? error.message : String(error)
		}, { status: 500 });
	}
};
