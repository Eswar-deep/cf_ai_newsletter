-- Create users table for newsletter subscribers
CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE NOT NULL,
    categories TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    active BOOLEAN DEFAULT 1
);

-- Insert sample users
INSERT OR IGNORE INTO users (email, categories) VALUES 
('eswardeeppujala@gmail.com', 'technology,business,science,health'),
('test@test.com', 'technology');