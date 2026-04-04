const express = require('express');
const app = express();
const cors = require('cors');
const authenticate = require('./middleware');

const {
  findUserByUsername,
  searchUsers,
  createFriendRequest,
  listFriendRequests,
  acceptFriendRequest,
} = require('./db');

app.use(express.json());

app.use(cors({
  origin: 'http://localhost:5173'
}));

app.use('/auth', require('./routes/auth.js'));
app.use('/friends', require('./routes/friends.js'));
app.use('/user', require('./routes/user.js'));
app.use('/spaces', require('./routes/spaces.js'));
app.use('/uploads', express.static(require('path').join(__dirname, '../../uploads')));

module.exports = app;