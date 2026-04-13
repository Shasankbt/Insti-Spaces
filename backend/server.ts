import 'dotenv/config';
import app from './src/app';

console.log('DB:', process.env.DB_NAME);
console.log('ENV FILE PATH:', process.cwd());

const PORT = process.env.PORT ?? 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
