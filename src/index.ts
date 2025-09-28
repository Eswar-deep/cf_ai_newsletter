/**
 * This is the main entrypoint for our Cloudflare Worker.
 * It will handle API requests for subscribing users and will eventually
 * be triggered by a cron job to send the daily briefing.
 */
import type { D1Database, ExecutionContext, Ai, ScheduledEvent } from '@cloudflare/workers-types';

export interface Env {
	// This binding gives us access to our D1 database.
	DB: D1Database;
	// This binding gives us access to the Workers AI models.
	AI: Ai;
	// This is a secret we will set to store our NewsAPI key.
	NEWS_API_KEY: string;

	// We will add more bindings for secrets and other services later.
}

interface SubscriptionRequest {
	email: string;
	categories: string[];
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
		// In the next step, we'll add the logic to fetch news, summarize, and send emails.
	},
};
