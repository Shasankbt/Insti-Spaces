import 'dotenv/config';
import app from './src/app';
import { purgeExpiredTrash } from './src/db/spaceItems';

console.log('DB:', process.env.DB_NAME);
console.log('ENV FILE PATH:', process.cwd());

const PORT = process.env.PORT ?? 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));

const runTrashCleanup = async (): Promise<void> => {
  try {
    await purgeExpiredTrash();
  } catch (err) {
    console.error('Trash cleanup failed:', err);
  }
};

void runTrashCleanup();
setInterval(() => {
  void runTrashCleanup();
}, 60 * 60 * 1000);
