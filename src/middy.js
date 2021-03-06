/**
 * @typedef middy
 * @type function
 * @param {Object} event - the AWS Lambda event from the original handler
 * @param {Object} context - the AWS Lambda context from the original handler
 * @param {function} callback - the AWS Lambda callback from the original handler
 * @property {useFunction} use - attach a new middleware
 * @property {middlewareAttachFunction} before - attach a new *before-only* middleware
 * @property {middlewareAttachFunction} after - attach a new *after-only* middleware
 * @property {middlewareAttachFunction} onError - attach a new *error-handler-only* middleware
 * @property {Object} __middlewares - contains the list of all the attached 
 *   middlewares organised by type (`before`, `after`, `onError`). To be used only
 *   for testing and debugging purposes
 */

/**
 * @typedef useFunction
 * @type {function}
 * @param {middlewareObject} - the middleware object to attach
 * @return {middy}
 */

/**
 * @typedef middlewareAttachFunction
 * @type {function}
 * @param {middlewareFunction} - the middleware function to attach
 * @return {middy}
 */

/**
 * @typedef middlewareFunction
 * @type {function}
 * @param {function} handler - the original handler function.
 *   It will expose properties `event`, `context`, `response` and `error` that can
 *   be used to interact with the middleware lifecycle
 * @param {function} next - the callback to invoke to pass the control to the next middleware
 */

/**
 * @typedef middlewareObject
 * @type Object
 * @property {middlewareFunction} before - the middleware function to attach as *before* middleware
 * @property {middlewareFunction} after - the middleware function to attach as *after* middleware
 * @property {middlewareFunction} onError - the middleware function to attach as *error* middleware
 */

const runMiddlewares = (middlewares, instance, done) => {
  const stack = Array.from(middlewares)
  const runNext = (err) => {
    try {
      if (err) {
        return done(err)
      }

      const nextMiddleware = stack.shift()

      if (nextMiddleware) {
        return nextMiddleware(instance, runNext)
      }

      return done()
    } catch (err) {
      return done(err)
    }
  }

  runNext()
}

const runErrorMiddlewares = (middlewares, instance, done) => {
  const stack = Array.from(middlewares)
  instance.__handledError = false
  const runNext = (err) => {
    try {
      if (!err) {
        instance.__handledError = true
      }

      const nextMiddleware = stack.shift()

      if (nextMiddleware) {
        return nextMiddleware(instance, runNext)
      }

      return done(instance.__handledError ? null : err)
    } catch (err) {
      return done(err)
    }
  }

  runNext(instance.error)
}

/**
 * Middy factory function. Use it to wrap your existing handler to enable middlewares on it.
 * @param  {function} handler - your original AWS Lambda function
 * @return {middy} - a `middy` instance
 */
const middy = (handler) => {
  const beforeMiddlewares = []
  const afterMiddlewares = []
  const errorMiddlewares = []

  const instance = (event, context, callback) => {
    instance.event = event
    instance.context = context
    instance.response = null
    instance.error = null

    const terminate = (err) => {
      if (err) {
        return callback(err)
      }

      return callback(null, instance.response)
    }

    const errorHandler = err => {
      if (err) {
        instance.error = err
        return runErrorMiddlewares(errorMiddlewares, instance, terminate)
      }
    }

    runMiddlewares(beforeMiddlewares, instance, (err) => {
      if (err) return errorHandler(err)

      handler.call(instance, instance.event, context, (err, response) => {
        instance.response = response

        if (err) return errorHandler(err)

        runMiddlewares(afterMiddlewares, instance, (err) => {
          if (err) return errorHandler(err)

          return terminate()
        })
      })
    })
  }

  instance.use = (middleware) => {
    if (typeof middleware !== 'object') {
      throw new Error('Middleware must be an object')
    }

    const { before, after, onError } = middleware

    if (!before && !after && !onError) {
      throw new Error('Middleware must contain at least one key among "before", "after", "onError"')
    }

    if (before) {
      instance.before(before)
    }

    if (after) {
      instance.after(after)
    }

    if (onError) {
      instance.onError(onError)
    }

    return instance
  }

  instance.before = (beforeMiddleware) => {
    beforeMiddlewares.push(beforeMiddleware)

    return instance
  }

  instance.after = (afterMiddleware) => {
    afterMiddlewares.unshift(afterMiddleware)

    return instance
  }

  instance.onError = (errorMiddleware) => {
    errorMiddlewares.push(errorMiddleware)

    return instance
  }

  instance.__middlewares = {
    before: beforeMiddlewares,
    after: afterMiddlewares,
    onError: errorMiddlewares
  }

  return instance
}

module.exports = middy
