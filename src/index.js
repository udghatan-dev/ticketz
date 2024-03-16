import express from 'express';
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import cors from 'cors'; // Import the cors middleware

dotenv.config();

const app = express();
const port = process.env.PORT || 3004;

// Middleware to parse JSON bodies
app.use(express.json({ strict: false }));

// Enable CORS
app.use(cors());

mongoose
  .connect(process.env.DB_CONNECTION_STRING, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
  })
  .then(() => console.log('MongoDB connected'))
  .catch((err) => console.error('MongoDB connection error:', err));

app.get('/', (req, res) => {
  return res.send('we are listening at ' + port);
});

import router from './routes/ticket.js';
app.use(
  '/api',
  (req, res, next) => {
    console.log(req.path);
    next();
  },
  router
);

app.listen(port, () => {
  console.log(`Server running on http://localhost:${port}`);
});
