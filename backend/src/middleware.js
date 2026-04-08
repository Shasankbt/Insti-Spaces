const jwt = require('jsonwebtoken');
const { getUserInSpace } = require('./db');


const authenticate = (req, res, next) => {
  const header = req.headers.authorization;
  if (!header) return res.status(401).json({ error: 'No token' });

  const token = header.split(' ')[1]; // "Bearer <token>"
  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Invalid token' });
  }
};


const isMember = async (req, res, next) => {
  const spaceId = Number(req.params.spaceId)
  if (!Number.isFinite(spaceId)) {
    return res.status(400).json({ error: 'Invalid spaceId' })
  }

  const member = await getUserInSpace({ spaceId, userId: req.user.id })
  if (!member) {
    return res.status(403).json({ error: 'Not a member of this space' })
  }

  req.member = member  // { userid, spaceid, role }
  next()
}

const deltaSync = async (req, res, next) => {
  const since = req.query.since

  const sinceDate = since ? new Date(since) : new Date(0)  // epoch if not given

  if (isNaN(sinceDate)) {
    return res.status(400).json({ error: 'Invalid since timestamp' })
  }

  req.since = new Date(sinceDate.getTime() + 1)
  next()
}

module.exports = deltaSync

module.exports = {
  authenticate,
  isMember,
  deltaSync
};