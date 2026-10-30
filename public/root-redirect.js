// Kept as a file rather than an inline <script> in index.html so the
// Content-Security-Policy (vercel.json) can stay script-src 'self' with no
// 'unsafe-inline' — see DECISIONS.md.
location.replace('src/shell/index.html')
