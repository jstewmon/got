'use strict';

// Forked from https://github.com/floatdrop/timed-out

module.exports = function (req, delays) {
	if (req.timeoutTimer) {
		return req;
	}
	let requestImmediate;
	let connectImmediate;

	const host = req._headers ? (' to ' + req._headers.host) : '';

	function throwESOCKETTIMEDOUT() {
		req.abort();
		const e = new Error('Socket timed out on request' + host);
		e.code = 'ESOCKETTIMEDOUT';
		req.emit('error', e);
	}

	function throwETIMEDOUT(code = 'ETIMEDOUT') {
		req.abort();
		const e = new Error('Connection timed out on request' + host);
		e.code = code;
		req.emit('error', e);
	}

	if (delays.connect !== undefined) {
		req.timeoutTimer = setTimeout(() => {
			connectImmediate = setImmediate(throwETIMEDOUT, 'connect timeout');
		}, delays.connect);
	}

	if (delays.request !== undefined) {
		req.requestTimeoutTimer = setTimeout(() => {
			requestImmediate = setImmediate(() => {
				clear();
				// throwETIMEDOUT('request timeout');
				if (req.connection.connecting) {
					throwETIMEDOUT('request timeout');
				} else {
					throwESOCKETTIMEDOUT();
				}
			})
		}, delays.request);
	}

	// Clear the connection timeout timer once a socket is assigned to the
	// request and is connected.
	req.on('socket', socket => {
		// Socket may come from Agent pool and may be already connected.
		if (!socket.connecting) {
			connect();
			return;
		}

		socket.once('connect', () => {
			clearImmediate(connectImmediate);
			connect();
		});
	});

	function clear() {
		if (req.timeoutTimer) {
			clearTimeout(req.timeoutTimer);
			req.timeoutTimer = null;
		}
	}

	function connect() {
		clear();

		if (delays.socket !== undefined) {
			// Abort the request if there is no activity on the socket for more
			// than `delays.socket` milliseconds.
			req.setTimeout(delays.socket, throwESOCKETTIMEDOUT);
		}

		req.on('response', res => {
			res.on('end', () => {
				// The request is finished, cancel request timeout.
				clearTimeout(req.requestTimeoutTimer);
				clearImmediate(requestImmediate);
			});
		});
	}

	return req.on('error', clear);
};
