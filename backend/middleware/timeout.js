export function requestTimeout(ms) {
  return (req, res, next) => {
    const start = Date.now();
    const requestId = req.get('X-Request-Id');
    if (requestId) {
      res.setHeader('X-Request-Id', requestId);
    }

    // Stamp the elapsed time just before the headers go out. (Setting it on 'finish'
    // is too late: headers are already sent, and the throw there crashed the process.)
    const writeHead = res.writeHead;
    res.writeHead = function patchedWriteHead(...args) {
      if (!res.headersSent) res.setHeader('X-Response-Time-Ms', String(Date.now() - start));
      return writeHead.apply(this, args);
    };

    const timer = setTimeout(() => {
      if (res.headersSent) return;
      res.status(504).json({ error: `Request exceeded ${ms}ms timeout` });
      // The route handler can't be cancelled and may still finish its work (e.g. a
      // PATCH may still be saved). Make its late reply a no-op instead of an error.
      res.status = () => res;
      res.json = () => res;
      res.send = () => res;
    }, ms);

    const done = () => clearTimeout(timer);
    res.on('finish', done);
    res.on('close', done);

    next();
  };
}
