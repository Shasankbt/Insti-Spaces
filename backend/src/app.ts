import express from 'express';
import cors from 'cors';
import path from 'path';
import authRouter from './routes/auth';
import friendsRouter from './routes/friends';
import userRouter from './routes/user';
import spacesRouter from './routes/spaces';

const app = express();

app.use(express.json());
app.use(cors({ origin: 'http://localhost:5173' }));

app.use('/auth', authRouter);
app.use('/friends', friendsRouter);
app.use('/user', userRouter);
app.use('/spaces', spacesRouter);
app.use('/uploads', express.static(path.join(__dirname, '../../uploads')));

export default app;
