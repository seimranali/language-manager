const VERSION = "5.34.1";

const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Language Manager API</title>
<link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@${VERSION}/swagger-ui.css"></head>
<body><div id="ui"></div>
<script src="https://unpkg.com/swagger-ui-dist@${VERSION}/swagger-ui-bundle.js"></script>
<script>SwaggerUIBundle({ url: "/api/v1/openapi.json", dom_id: "#ui" });</script>
</body></html>`;

export function GET() {
  return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8" } });
}
