require('dotenv').config();
const app = require('./src/app');
const cors = require('cors');

console.log('DB:', process.env.DB_NAME);
console.log('ENV FILE PATH:', process.cwd());

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));