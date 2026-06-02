/* eslint-disable */
const { PDFParse } = require("pdf-parse");
const fs = require("fs");

const filePath = process.argv[2];

if (!filePath) {
  console.error(JSON.stringify({ error: "Missing file path argument" }));
  process.exit(1);
}

try {
  const buffer = fs.readFileSync(filePath);
  const parser = new PDFParse({ data: buffer });
  parser.getText()
    .then((result) => {
      console.log(JSON.stringify({
        text: result.text || "",
        total: result.total || 1,
        pages: result.pages || [],
      }));
      parser.destroy().then(() => process.exit(0));
    })
    .catch((err) => {
      console.error(JSON.stringify({ error: err.message }));
      process.exit(1);
    });
} catch (err) {
  console.error(JSON.stringify({ error: err.message }));
  process.exit(1);
}
