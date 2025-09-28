var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// .wrangler/tmp/bundle-gNh8F9/checked-fetch.js
var urls = /* @__PURE__ */ new Set();
function checkURL(request, init) {
  const url = request instanceof URL ? request : new URL(
    (typeof request === "string" ? new Request(request, init) : request).url
  );
  if (url.port && url.port !== "443" && url.protocol === "https:") {
    if (!urls.has(url.toString())) {
      urls.add(url.toString());
      console.warn(
        `WARNING: known issue with \`fetch()\` requests to custom HTTPS ports in published Workers:
 - ${url.toString()} - the custom port will be ignored when the Worker is published using the \`wrangler deploy\` command.
`
      );
    }
  }
}
__name(checkURL, "checkURL");
globalThis.fetch = new Proxy(globalThis.fetch, {
  apply(target, thisArg, argArray) {
    const [request, init] = argArray;
    checkURL(request, init);
    return Reflect.apply(target, thisArg, argArray);
  }
});

// src/index.ts
async function fetchNewsForCategories(categories, apiKey) {
  const allArticles = [];
  for (const category of categories) {
    try {
      console.log(`\u{1F50D} Fetching news for category: ${category}`);
      const url = `https://newsapi.org/v2/top-headlines?category=${category}&country=us&pageSize=5&apiKey=${apiKey}`;
      console.log(`\u{1F4E1} Making request to: ${url.replace(apiKey, "API_KEY_HIDDEN")}`);
      console.log(`\u{1F511} Using API key: ${apiKey.substring(0, 8)}...${apiKey.substring(apiKey.length - 4)}`);
      const response = await fetch(url, {
        headers: {
          "User-Agent": "CF-AI-Newsletter/1.0 (Cloudflare Worker)"
        }
      });
      console.log(`Response status: ${response.status} ${response.statusText}`);
      if (!response.ok) {
        const errorText = await response.text();
        console.error(`\u274C Failed to fetch news for ${category}:`, response.status, errorText);
        console.error(`\u274C Full error response:`, errorText);
        continue;
      }
      const data = await response.json();
      console.log(`\u{1F4CA} Found ${data.articles?.length || 0} articles for ${category}`);
      console.log(`\u{1F4CA} Total results available: ${data.totalResults || "unknown"}`);
      console.log(`\u{1F4CB} Raw API response for ${category}:`, JSON.stringify(data, null, 2));
      if (!data.articles || data.articles.length === 0) {
        console.log(`No articles returned for ${category}`);
        continue;
      }
      const categoryArticles = data.articles.filter((article) => {
        const hasContent = article.content && article.content !== "[Removed]";
        if (!hasContent) {
          console.log(`Skipping article without content: ${article.title}`);
        }
        return hasContent;
      }).map((article) => ({
        ...article,
        category
      }));
      console.log(`Filtered to ${categoryArticles.length} articles with content for ${category}`);
      allArticles.push(...categoryArticles);
    } catch (error) {
      console.error(`Error fetching news for category ${category}:`, error);
    }
  }
  return allArticles;
}
__name(fetchNewsForCategories, "fetchNewsForCategories");
async function summarizeArticleWithLlama(article, ai) {
  try {
    console.log(`\u{1F916} Summarizing article with Llama 2: ${article.title}`);
    const articleContent = article.content || article.description || "No content available";
    const prompt = `Summarize this news article in exactly 1-2 clear, concise sentences. Focus on the main facts and key information.

Title: ${article.title}
Content: ${articleContent.substring(0, 1e3)}...
Source: ${article.source.name}

Summary:`;
    const modelName = "@cf/meta/llama-2-7b-chat-int8";
    const response = await ai.run(modelName, {
      prompt: `${prompt}

Assistant: Here's a concise summary:`
    });
    let summary;
    if (typeof response === "string") {
      summary = response.trim();
    } else if (response && typeof response === "object" && "response" in response) {
      summary = response.response?.trim();
    } else {
      summary = `${article.title}: Summary not available`;
    }
    console.log(`\u2705 Generated summary: ${summary.substring(0, 100)}...`);
    return summary;
  } catch (error) {
    console.error(`\u274C Error summarizing article "${article.title}":`, error);
    const fallbackSummary = createFallbackSummary(article);
    console.log(`\u{1F504} Using fallback summary: ${fallbackSummary.substring(0, 100)}...`);
    return fallbackSummary;
  }
}
__name(summarizeArticleWithLlama, "summarizeArticleWithLlama");
function createFallbackSummary(article) {
  const description = article.description || "";
  const content = article.content || "";
  if (description && description.length > 10 && description !== "[Removed]") {
    return `${article.source.name} reports: ${description}`;
  } else if (content && content.length > 50) {
    const sentences = content.split(/[.!?]+/);
    const firstSentence = sentences[0]?.trim();
    if (firstSentence && firstSentence.length > 20) {
      return `${article.source.name}: ${firstSentence}.`;
    }
  }
  return `${article.source.name}: ${article.title}`;
}
__name(createFallbackSummary, "createFallbackSummary");
async function testNewsAPI(request, env) {
  try {
    const body = await request.json().catch(() => ({}));
    const apiKey = body.apiKey || env.NEWS_API_KEY;
    if (!apiKey) {
      return Response.json({
        message: 'NewsAPI key is required. Send it in the request body as {"apiKey": "your-key"} or set NEWS_API_KEY environment variable.',
        example: {
          method: "POST",
          body: '{"apiKey": "your-newsapi-key", "categories": ["technology", "science"]}'
        }
      }, { status: 400 });
    }
    const categories = body.categories || ["technology", "science"];
    console.log(`Testing NewsAPI with categories: ${categories.join(", ")}`);
    console.log(`API Key provided: ${apiKey.substring(0, 8)}...${apiKey.substring(apiKey.length - 4)}`);
    const articles = await fetchNewsForCategories(categories, apiKey);
    console.log(`Total articles fetched: ${articles.length}`);
    if (articles.length === 0) {
      return Response.json({
        message: "No articles found. This could mean:",
        possibleCauses: [
          "Invalid API key - check if your NewsAPI key is correct",
          "API rate limit exceeded - free tier allows 100 requests/day",
          "No articles available for the selected categories today",
          "Network connectivity issue",
          "NewsAPI service temporarily unavailable"
        ],
        categories,
        debugging: {
          apiKeyFormat: `${apiKey.substring(0, 8)}...${apiKey.substring(apiKey.length - 4)}`,
          timestamp: (/* @__PURE__ */ new Date()).toISOString()
        }
      }, { status: 404 });
    }
    const summaries = [];
    for (const article of articles.slice(0, 5)) {
      const summary = await summarizeArticleWithLlama(article, env.AI);
      summaries.push({
        title: article.title,
        summary,
        url: article.url,
        source: article.source.name,
        category: article.category || "general"
      });
    }
    return Response.json({
      message: `Successfully fetched ${articles.length} articles from NewsAPI!`,
      categories,
      articlesFound: articles.length,
      sampleSummaries: summaries,
      testSuccess: true
    });
  } catch (error) {
    console.error("NewsAPI test failed:", error);
    return Response.json({
      message: "NewsAPI test failed",
      error: error instanceof Error ? error.message : String(error)
    }, { status: 500 });
  }
}
__name(testNewsAPI, "testNewsAPI");
async function handleSubscribe(request, env) {
  console.log("handleSubscribe called");
  try {
    const body = await request.json();
    console.log("Request body:", body);
    const { email, categories } = body;
    if (!email || !Array.isArray(categories) || categories.length === 0) {
      console.log("Validation failed");
      return Response.json({ message: "Invalid input: email and at least one category are required." }, { status: 400 });
    }
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      console.log("Email format invalid");
      return Response.json({ message: "Invalid email format." }, { status: 400 });
    }
    console.log(`Attempting to save subscription for email: ${email}`);
    const categoriesJson = JSON.stringify(categories);
    const stmt = env.DB.prepare(
      "INSERT INTO users (email, categories) VALUES (?1, ?2) ON CONFLICT(email) DO UPDATE SET categories = ?2"
    );
    const result = await stmt.bind(email, categoriesJson).run();
    console.log("Database operation result:", result);
    if (result.success) {
      return Response.json({ message: "Configuration saved successfully!" }, { status: 200 });
    } else {
      console.error("Database operation failed:", result.error);
      return Response.json({ message: "Database operation failed." }, { status: 500 });
    }
  } catch (e) {
    console.error("Error in handleSubscribe:", e);
    if (e instanceof SyntaxError) {
      return Response.json({ message: "Invalid JSON in request body." }, { status: 400 });
    }
    return Response.json({ message: "An internal server error occurred." }, { status: 500 });
  }
}
__name(handleSubscribe, "handleSubscribe");
var HTML_CONTENT = `<!DOCTYPE html>
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
        <h2>\u{1F9EA} Test NewsAPI Integration</h2>
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
            let html = \`<h3>\u2705 Success! Found \${result.articlesFound} articles</h3>\`;
            html += \`<p><strong>Categories tested:</strong> \${result.categories.join(', ')}</p>\`;
            
            if (result.sampleSummaries && result.sampleSummaries.length > 0) {
                html += \`<h4>\u{1F4F0} Sample Articles:</h4>\`;
                result.sampleSummaries.forEach((item, index) => {
                    html += \`
                        <div style="margin: 1rem 0; padding: 1rem; border-left: 3px solid #007bff; background-color: #f8f9fa;">
                            <strong>\${index + 1}. \${item.title}</strong><br>
                            <em>Source: \${item.source} | Category: \${item.category}</em><br>
                            <p style="margin: 0.5rem 0;">\${item.summary}</p>
                            <a href="\${item.url}" target="_blank" style="color: #007bff;">Read full article \u2192</a>
                        </div>
                    \`;
                });
            }
            
            return html;
        }
    <\/script>
</body>
</html>`;
var src_default = {
  /**
   * The main fetch handler. We wrap the router in a try/catch block to ensure
   * that we always return a response, even if the router encounters an error.
   * This prevents the "The script will never generate a response" error.
   */
  async fetch(request, env, ctx) {
    console.log(`[FETCH] ${request.method} ${request.url}`);
    const url = new URL(request.url);
    console.log(`[FETCH] Pathname: ${url.pathname}`);
    if (url.pathname.startsWith("/api/")) {
      console.log("[FETCH] Handling API route");
      if (url.pathname === "/api/subscribe" && request.method === "POST") {
        console.log("[FETCH] Handling subscribe route directly");
        return await handleSubscribe(request, env);
      }
      if (url.pathname === "/api/hello" && request.method === "GET") {
        console.log("[FETCH] Hello endpoint called");
        return Response.json({ message: "Hello! Server is working!", timestamp: (/* @__PURE__ */ new Date()).toISOString() });
      }
      if (url.pathname === "/api/test-news" && request.method === "POST") {
        console.log("[FETCH] Testing NewsAPI integration");
        return await testNewsAPI(request, env);
      }
      if (url.pathname === "/api/test-newsletter" && request.method === "POST") {
        console.log("[FETCH] Testing newsletter generation");
        return await testNewsletterGeneration(env);
      }
      return new Response("API Route Not Found", { status: 404 });
    }
    if (url.pathname === "/") {
      console.log("[FETCH] Serving HTML content");
      return new Response(HTML_CONTENT, {
        headers: { "Content-Type": "text/html" }
      });
    }
    console.log("[FETCH] Returning 404");
    return new Response("Not Found", { status: 404 });
  },
  /**
   * This is the scheduled handler, which will be executed by the cron trigger.
   */
  async scheduled(event, env, ctx) {
    console.log(`Cron trigger fired at ${new Date(event.scheduledTime)}. Time to build the newsletter.`);
    try {
      if (!env.NEWS_API_KEY) {
        console.error("NEWS_API_KEY is not set in environment variables");
        return;
      }
      console.log("Fetching all users from database...");
      const usersResult = await env.DB.prepare("SELECT email, categories FROM users").all();
      if (!usersResult.success) {
        console.error("Failed to fetch users from database");
        return;
      }
      const users = usersResult.results;
      console.log(`Found ${users.length} users to process`);
      for (const user of users) {
        await processUserNewsletter(user, env);
      }
      console.log("Newsletter processing completed successfully");
    } catch (error) {
      console.error("Error in scheduled newsletter processing:", error);
    }
  }
};
async function processUserNewsletter(user, env) {
  try {
    const email = user.email;
    const categories = JSON.parse(user.categories);
    console.log(`Processing newsletter for ${email} with categories: ${categories.join(", ")}`);
    const articles = await fetchNewsForCategories(categories, env.NEWS_API_KEY);
    if (articles.length === 0) {
      console.log(`No articles found for ${email}`);
      return;
    }
    console.log(`Found ${articles.length} articles for ${email}`);
    const summaries = [];
    for (const article of articles.slice(0, 10)) {
      const summary = await summarizeArticleWithLlama(article, env.AI);
      summaries.push({
        article,
        summary,
        category: article.category || "general"
      });
    }
    const newsletter = formatNewsletter(email, summaries);
    console.log(`Newsletter generated for ${email}:`);
    console.log(newsletter);
    console.log("--- End of Newsletter ---\n");
  } catch (error) {
    console.error(`Error processing newsletter for user:`, error);
  }
}
__name(processUserNewsletter, "processUserNewsletter");
function formatNewsletter(email, summaries) {
  const date = (/* @__PURE__ */ new Date()).toDateString();
  const categorizedSummaries = {};
  for (const item of summaries) {
    if (!categorizedSummaries[item.category]) {
      categorizedSummaries[item.category] = [];
    }
    categorizedSummaries[item.category].push({
      article: item.article,
      summary: item.summary
    });
  }
  let newsletter = `\u{1F5DE}\uFE0F Your Daily AI-Powered News Briefing - ${date}
`;
  newsletter += `\u{1F4E7} For: ${email}

`;
  for (const [category, items] of Object.entries(categorizedSummaries)) {
    newsletter += `\u{1F4C2} ${category.toUpperCase()}
`;
    newsletter += `${"=".repeat(category.length + 2)}

`;
    for (let i = 0; i < items.length; i++) {
      const { article, summary } = items[i];
      newsletter += `${i + 1}. ${article.title}
`;
      newsletter += `   \u{1F916} AI Summary: ${summary}
`;
      newsletter += `   \u{1F517} Read more: ${article.url}
`;
      newsletter += `   \u{1F4F0} Source: ${article.source.name}

`;
    }
  }
  newsletter += `
\u{1F4DD} This newsletter was generated using Cloudflare Workers AI
`;
  newsletter += `\u2699\uFE0F Powered by NewsAPI and Llama 3 AI
`;
  return newsletter;
}
__name(formatNewsletter, "formatNewsletter");
async function testNewsletterGeneration(env) {
  try {
    const testApiKey = env.NEWS_API_KEY || "test-api-key";
    const usersResult = await env.DB.prepare("SELECT email, categories FROM users LIMIT 1").all();
    if (!usersResult.success || usersResult.results.length === 0) {
      return Response.json({
        message: "No users found in database. Please subscribe first using the form."
      }, { status: 404 });
    }
    const user = usersResult.results[0];
    const email = user.email;
    const categories = JSON.parse(user.categories);
    if (!env.NEWS_API_KEY) {
      return await testWithMockData(email, categories, env);
    }
    await processUserNewsletter(user, env);
    return Response.json({
      message: `Newsletter generated successfully for ${email}. Check the console logs for the output.`,
      categories
    });
  } catch (error) {
    console.error("Error in test newsletter generation:", error);
    return Response.json({
      message: "Error generating test newsletter",
      error: error instanceof Error ? error.message : String(error)
    }, { status: 500 });
  }
}
__name(testNewsletterGeneration, "testNewsletterGeneration");
async function testWithMockData(email, categories, env) {
  try {
    const mockArticles = [
      {
        title: "AI Technology Breakthrough in 2025",
        description: "Researchers announce major advancement in artificial intelligence capabilities with new transformer architecture.",
        content: "Scientists at leading research institutions have developed a new AI architecture that shows significant improvements in reasoning and understanding. The breakthrough could revolutionize how we interact with AI systems.",
        url: "https://example.com/ai-breakthrough",
        source: { name: "Tech News Daily" },
        publishedAt: (/* @__PURE__ */ new Date()).toISOString()
      },
      {
        title: "Climate Change Solutions Show Promise",
        description: "New renewable energy technology could help reduce carbon emissions by 50% over the next decade.",
        content: "A consortium of environmental scientists has developed innovative solar panel technology that is both more efficient and cheaper to produce than current methods.",
        url: "https://example.com/climate-solution",
        source: { name: "Environmental Report" },
        publishedAt: (/* @__PURE__ */ new Date()).toISOString()
      }
    ];
    const summaries = [];
    for (let i = 0; i < mockArticles.length; i++) {
      const article = mockArticles[i];
      const category = categories[i % categories.length];
      const summary = await summarizeArticleWithLlama(article, env.AI);
      summaries.push({
        article,
        summary,
        category
      });
    }
    const newsletter = formatNewsletter(email, summaries);
    console.log(`TEST NEWSLETTER GENERATED:`);
    console.log(newsletter);
    return Response.json({
      message: `Test newsletter generated successfully for ${email}!`,
      newsletter,
      articlesProcessed: mockArticles.length
    });
  } catch (error) {
    console.error("Error in mock newsletter generation:", error);
    return Response.json({
      message: "Error generating mock newsletter",
      error: error instanceof Error ? error.message : String(error)
    }, { status: 500 });
  }
}
__name(testWithMockData, "testWithMockData");

// ../../../../AppData/Local/npm-cache/_npx/32026684e21afda6/node_modules/wrangler/templates/middleware/middleware-ensure-req-body-drained.ts
var drainBody = /* @__PURE__ */ __name(async (request, env, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env);
  } finally {
    try {
      if (request.body !== null && !request.bodyUsed) {
        const reader = request.body.getReader();
        while (!(await reader.read()).done) {
        }
      }
    } catch (e) {
      console.error("Failed to drain the unused request body.", e);
    }
  }
}, "drainBody");
var middleware_ensure_req_body_drained_default = drainBody;

// ../../../../AppData/Local/npm-cache/_npx/32026684e21afda6/node_modules/wrangler/templates/middleware/middleware-miniflare3-json-error.ts
function reduceError(e) {
  return {
    name: e?.name,
    message: e?.message ?? String(e),
    stack: e?.stack,
    cause: e?.cause === void 0 ? void 0 : reduceError(e.cause)
  };
}
__name(reduceError, "reduceError");
var jsonError = /* @__PURE__ */ __name(async (request, env, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env);
  } catch (e) {
    const error = reduceError(e);
    return Response.json(error, {
      status: 500,
      headers: { "MF-Experimental-Error-Stack": "true" }
    });
  }
}, "jsonError");
var middleware_miniflare3_json_error_default = jsonError;

// .wrangler/tmp/bundle-gNh8F9/middleware-insertion-facade.js
var __INTERNAL_WRANGLER_MIDDLEWARE__ = [
  middleware_ensure_req_body_drained_default,
  middleware_miniflare3_json_error_default
];
var middleware_insertion_facade_default = src_default;

// ../../../../AppData/Local/npm-cache/_npx/32026684e21afda6/node_modules/wrangler/templates/middleware/common.ts
var __facade_middleware__ = [];
function __facade_register__(...args) {
  __facade_middleware__.push(...args.flat());
}
__name(__facade_register__, "__facade_register__");
function __facade_invokeChain__(request, env, ctx, dispatch, middlewareChain) {
  const [head, ...tail] = middlewareChain;
  const middlewareCtx = {
    dispatch,
    next(newRequest, newEnv) {
      return __facade_invokeChain__(newRequest, newEnv, ctx, dispatch, tail);
    }
  };
  return head(request, env, ctx, middlewareCtx);
}
__name(__facade_invokeChain__, "__facade_invokeChain__");
function __facade_invoke__(request, env, ctx, dispatch, finalMiddleware) {
  return __facade_invokeChain__(request, env, ctx, dispatch, [
    ...__facade_middleware__,
    finalMiddleware
  ]);
}
__name(__facade_invoke__, "__facade_invoke__");

// .wrangler/tmp/bundle-gNh8F9/middleware-loader.entry.ts
var __Facade_ScheduledController__ = class ___Facade_ScheduledController__ {
  constructor(scheduledTime, cron, noRetry) {
    this.scheduledTime = scheduledTime;
    this.cron = cron;
    this.#noRetry = noRetry;
  }
  static {
    __name(this, "__Facade_ScheduledController__");
  }
  #noRetry;
  noRetry() {
    if (!(this instanceof ___Facade_ScheduledController__)) {
      throw new TypeError("Illegal invocation");
    }
    this.#noRetry();
  }
};
function wrapExportedHandler(worker) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return worker;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  const fetchDispatcher = /* @__PURE__ */ __name(function(request, env, ctx) {
    if (worker.fetch === void 0) {
      throw new Error("Handler does not export a fetch() function.");
    }
    return worker.fetch(request, env, ctx);
  }, "fetchDispatcher");
  return {
    ...worker,
    fetch(request, env, ctx) {
      const dispatcher = /* @__PURE__ */ __name(function(type, init) {
        if (type === "scheduled" && worker.scheduled !== void 0) {
          const controller = new __Facade_ScheduledController__(
            Date.now(),
            init.cron ?? "",
            () => {
            }
          );
          return worker.scheduled(controller, env, ctx);
        }
      }, "dispatcher");
      return __facade_invoke__(request, env, ctx, dispatcher, fetchDispatcher);
    }
  };
}
__name(wrapExportedHandler, "wrapExportedHandler");
function wrapWorkerEntrypoint(klass) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return klass;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  return class extends klass {
    #fetchDispatcher = /* @__PURE__ */ __name((request, env, ctx) => {
      this.env = env;
      this.ctx = ctx;
      if (super.fetch === void 0) {
        throw new Error("Entrypoint class does not define a fetch() function.");
      }
      return super.fetch(request);
    }, "#fetchDispatcher");
    #dispatcher = /* @__PURE__ */ __name((type, init) => {
      if (type === "scheduled" && super.scheduled !== void 0) {
        const controller = new __Facade_ScheduledController__(
          Date.now(),
          init.cron ?? "",
          () => {
          }
        );
        return super.scheduled(controller);
      }
    }, "#dispatcher");
    fetch(request) {
      return __facade_invoke__(
        request,
        this.env,
        this.ctx,
        this.#dispatcher,
        this.#fetchDispatcher
      );
    }
  };
}
__name(wrapWorkerEntrypoint, "wrapWorkerEntrypoint");
var WRAPPED_ENTRY;
if (typeof middleware_insertion_facade_default === "object") {
  WRAPPED_ENTRY = wrapExportedHandler(middleware_insertion_facade_default);
} else if (typeof middleware_insertion_facade_default === "function") {
  WRAPPED_ENTRY = wrapWorkerEntrypoint(middleware_insertion_facade_default);
}
var middleware_loader_entry_default = WRAPPED_ENTRY;
export {
  __INTERNAL_WRANGLER_MIDDLEWARE__,
  middleware_loader_entry_default as default
};
//# sourceMappingURL=index.js.map
