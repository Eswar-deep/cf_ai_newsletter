# AI-Powered Daily Briefing Newsletter

This project is a fully-automated newsletter service that fetches news based on user preferences, uses an LLM to rephrase it in simple terms, and emails the daily briefing to subscribed users.

## Overview

The application consists of two main parts:
1.  A public-facing configuration page where users can subscribe with their email and select news categories of interest.
2.  A scheduled daily task that fetches the latest articles for the selected categories, uses AI to create simple summaries, and emails the personalized briefings to each subscriber.

## Tech Stack & Features

- **LLM:** Uses the Llama 3 model via **Cloudflare Workers AI** to rephrase and summarize news articles.
- **Workflow / Coordination:** A **Cloudflare Worker** handles user subscriptions and is triggered by a **Cron Trigger** to execute the daily newsletter generation and sending process.
- **User Input:** A static HTML page allows users to subscribe and configure their preferences.
- **Memory / State:** User subscriptions and preferences are stored in a **Cloudflare D1** database.

## Setup & Configuration

You will need an API key from a news provider like NewsAPI.

### Secrets

Securely store your NewsAPI key so the Worker can access it. In your terminal, run:

```bash
# Replace YOUR_API_KEY with your actual key from NewsAPI
npx wrangler secret put NEWS_API_KEY
```

## Running Locally

1.  **Clone the repository:**
    ```bash
    git clone <your-repo-url>
    cd cf_ai_newsletter
    ```

2.  **Install dependencies:**
    ```bash
    npm install
    ```

3.  **Run the local development server:**
    This command starts a local server that simulates the Cloudflare environment, including access to a local version of the D1 database.
    ```bash
    npx wrangler dev
    ```
4.  Open your browser and navigate to `http://127.0.0.1:8787`.