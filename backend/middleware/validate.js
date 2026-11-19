// Request validation. Usage in a route:
//
//   router.post('/', validate({ body: createTransactionSchema }), controller.create);
//
// The parsed, type-coerced result is placed on req.validated.{body,query,params}. Controllers
// read from there only, so anything the schema does not declare never reaches a service
// (Zod drops unknown keys by default).
const ApiError = require('../utils/ApiError');

const PARTS = ['params', 'query', 'body'];

function validate(schemas) {
  return (req, _res, next) => {
    const validated = {};
    const details = [];
    for (const part of PARTS) {
      if (!schemas[part]) continue;
      const result = schemas[part].safeParse(req[part] ?? {});
      if (result.success) {
        validated[part] = result.data;
      } else {
        for (const issue of result.error.issues) {
          details.push({ field: [part, ...issue.path].join('.'), message: issue.message });
        }
      }
    }
    if (details.length) return next(ApiError.validation(details));
    req.validated = validated;
    return next();
  };
}

module.exports = validate;
