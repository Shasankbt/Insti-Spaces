const express = require('express');
const app = express();
const cors = require('cors');

app.use(express.json());

app.use(cors({
  origin: 'http://localhost:5173'
}));

app.use('/auth', require('./routes/auth.js'));
    
module.exports = app;