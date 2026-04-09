require('dotenv').config();

const app = require('./src/app');

const PORT = Number(process.env.PORT) || 3000;

app.listen(PORT, () => {
  console.log(`Backend running on http://localhost:${PORT}`);
});
