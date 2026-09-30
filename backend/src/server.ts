import express from 'express';
import cors from 'cors';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { initHardware } from './hardware';
import { router } from './routes';
import './database';

const app = express();
app.use(cors());
app.use(express.json());
app.use('/api', router);

const httpServer = createServer(app);
const io = new Server(httpServer, {
    cors: { origin: '*' }
});

io.on('connection', (socket) => {
    console.log('[SOCKET] Client connected');
    socket.on('disconnect', () => console.log('[SOCKET] Client disconnected'));
});

const PORT = 3001;
const HOST = '0.0.0.0';
httpServer.listen(PORT, HOST, async () => {
    console.log(`[SERVER] Backend running on http://${HOST}:${PORT}`);
    await initHardware();
});
