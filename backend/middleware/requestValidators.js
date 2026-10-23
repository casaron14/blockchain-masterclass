export function validatePositiveIntegerRouteParam(paramName) {
  return (req, res, next) => {
    const rawParamValue = req.params[paramName];
    const parsedIntegerValue = Number.parseInt(rawParamValue, 10);

    if (
      rawParamValue === undefined ||
      !Number.isInteger(parsedIntegerValue) ||
      String(parsedIntegerValue) !== rawParamValue ||
      parsedIntegerValue <= 0
    ) {
      return res.status(400).json({
        message: `Invalid ${paramName}: must be a positive integer`,
        error: 'INVALID_ROUTE_PARAM',
      });
    }

    req.params[paramName] = parsedIntegerValue;
    next();
  };
}