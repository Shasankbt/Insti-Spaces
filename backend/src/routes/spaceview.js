const express = require('express');
const router = express.Router();
const { authenticate, isMember } = require('../middleware');

const {
  getSpaceById, getSpaceMembers
} = require('../db');

router.get('/:spaceId', authenticate, isMember, async (req, res) => {
  try {
    const spaceId = Number(req.params.spaceId);
    const space = await getSpaceById({ spaceId });
    res.json({ space: { ...space, role: req.member.role } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/:spaceId/members', authenticate, isMember, async (req, res) => {
  try {
    const spaceId = Number(req.params.spaceId);
    const members = await getSpaceMembers(spaceId);
    res.json({ members });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
})

module.exports = router;