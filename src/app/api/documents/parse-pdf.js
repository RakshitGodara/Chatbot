/* eslint-disable */
const pdfParse = require("pdf-parse");
const fs = require("fs");

const filePath = process.argv[2];

if (!filePath) {
  console.error(JSON.stringify({ error: "Missing file path argument" }));
  process.exit(1);
}

(async () => {
  try {
    const buffer = fs.readFileSync(filePath);
    const result = await pdfParse(buffer);
    console.log(JSON.stringify({
      text: result.text || "",
      total: result.numpages || 1,
      pages: [],
    }));
    process.exit(0);
  } catch (err) {
    console.error(JSON.stringify({ error: err.message }));
    process.exit(1);
  }
})();

