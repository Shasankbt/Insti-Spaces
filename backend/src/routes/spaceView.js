const express = require('express');
const router = express.Router({ mergeParams: true });
const { authenticate, isMember } = require('../middleware');
const { getSpaceById, getSpaceMembers } = require('../db');
const { parseSpaceId } = require('./spacesHelpers');

// GET /spaces/:spaceId — get space details
router.get('/', authenticate, isMember, async (req, res) => {
  try {
    const spaceId = parseSpaceId(req);
    const space = await getSpaceById({ spaceId });
    res.json({ space: { ...space, role: req.member.role } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /spaces/:spaceId/members — list members of a space
router.get('/members', authenticate, isMember, async (req, res) => {
  try {
    const spaceId = parseSpaceId(req);
    const members = await getSpaceMembers(spaceId);
    res.json({ members });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
