// /api/users: the signed-in user's own account. Every route requires authentication.
const { Router } = require('express');
const validate = require('../middleware/validate');
const { authenticate } = require('../middleware/authenticate');
const schemas = require('../validators/user.validators');
const controller = require('../controllers/user.controller');

const router = Router();

router.use(authenticate);

router.get('/profile', controller.getProfile);
router.put('/profile', validate({ body: schemas.updateProfile }), controller.updateProfile);
router.put('/password', validate({ body: schemas.changePassword }), controller.changePassword);
router.post('/deactivate', validate({ body: schemas.deactivate }), controller.deactivate);

module.exports = router;
