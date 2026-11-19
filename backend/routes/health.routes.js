const { Router } = require('express');
const healthController = require('../controllers/health.controller');

const router = Router();

router.get('/', healthController.live);
router.get('/ready', healthController.ready);

module.exports = router;
