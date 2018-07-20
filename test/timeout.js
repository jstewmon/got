import fs from 'fs';
import zlib from 'zlib';
import getStream from 'get-stream';
import test from 'ava';
import pEvent from 'p-event';
import delay from 'delay';
import got from '../source';
import {createServer} from './helpers/server';
import { resolve } from 'dns';

let s;
const reqDelay = 160;
const loadDelay = 6;

test.before('setup', async () => {
	s = await createServer();

	s.on('/', async (req, res) => {
		await delay(reqDelay);
		res.statusCode = 200;
		res.end('OK');
	});
	s.on('/load', async (req, res) => {
		// await delay(loadDelay);
		res.statusCode = 200;
		res.setHeader('content-encoding', 'gzip');
		fs.createReadStream(`${__dirname}/random.bin.gz`)
			// .pipe(new zlib.Gzip())
			.pipe(res);
	})

	await s.listen(s.port);
});

test.only('timeout under load', async t => {
	const limit = 3000;
	let passCount = 0;
	let failCount = 0;
	const failures = [];
	const pending = [];
	let gatherCallback;
	const gatherPromise = new Promise(
		(resolve) => {
			gatherCallback = resolve;
		}
	)
	const interval = setInterval(
		() => {
			const req = got(`${s.url}/load`, {
				retry: 0,
				timeout: {
					connect: 75,
					// socket:  50,
					request: 75
				}
			})
			pending.push(req);
			if (pending.length === limit) {
				clearInterval(interval);
				gatherCallback();
			}
		},
		3
	);
	await gatherPromise;
	for (let i = 0; i < pending.length; i++) {
		try {
			await pending[i];
			passCount++;
		} catch (err) {
			failCount++;
			failures.push([i, err])
		}
	}
	console.log(`pass / fail: ${passCount} / ${failCount}`);
	console.log(`failure rate: ${failCount / pending.length}`);
	console.log(`failed positions: ${JSON.stringify(failures.map(f => f[0]))}`);
	t.pass();
});

test('timeout option (ETIMEDOUT)', async t => {
	await t.throws(
		got(s.url, {
			timeout: 0,
			retry: 0
		}),
		{
			code: 'ETIMEDOUT'
		}
	);
});

test('timeout option (ESOCKETTIMEDOUT)', async t => {
	await t.throws(
		got(s.url, {
			timeout: reqDelay,
			retry: 0
		}),
		{
			code: 'ESOCKETTIMEDOUT'
		}
	);
});

test('timeout option as object (ETIMEDOUT)', async t => {
	await t.throws(
		got(s.url, {
			timeout: {socket: reqDelay * 2.5, request: 0},
			retry: 0
		}),
		{
			code: 'ETIMEDOUT'
		}
	);
});

test('timeout option as object (ESOCKETTIMEDOUT)', async t => {
	await t.throws(
		got(s.url, {
			timeout: {socket: reqDelay * 1.5, request: reqDelay},
			retry: 0
		}),
		{
			code: 'ESOCKETTIMEDOUT'
		}
	);
});

test('socket timeout', async t => {
	await t.throws(
		got(s.url, {
			timeout: {socket: reqDelay / 20},
			retry: 0
		}),
		{
			code: 'ESOCKETTIMEDOUT'
		}
	);
});

test.todo('connection timeout');

test('request timeout', async t => {
	await t.throws(
		got(s.url, {
			timeout: {request: reqDelay},
			retry: 0
		}),
		{
			code: 'ESOCKETTIMEDOUT'
		}
	);
});

test('retries on timeout (ESOCKETTIMEDOUT)', async t => {
	let tried = false;

	await t.throws(got(s.url, {
		timeout: reqDelay,
		retry: {
			retries: () => {
				if (tried) {
					return 0;
				}

				tried = true;
				return 1;
			}
		}
	}), {
		code: 'ESOCKETTIMEDOUT'
	});

	t.true(tried);
});

test('retries on timeout (ETIMEDOUT)', async t => {
	let tried = false;

	await t.throws(got(s.url, {
		timeout: 0,
		retry: {
			retries: () => {
				if (tried) {
					return 0;
				}

				tried = true;
				return 1;
			}
		}
	}), {code: 'ETIMEDOUT'});

	t.true(tried);
});

test('timeout with streams', async t => {
	const stream = got.stream(s.url, {
		timeout: 0,
		retry: 0
	});
	await t.throws(pEvent(stream, 'response'), {code: 'ETIMEDOUT'});
});

test('no error emitted when timeout is not breached (stream)', async t => {
	const stream = got.stream(s.url, {
		retry: 0,
		timeout: {
			request: reqDelay * 2
		}
	});
	stream.on('error', err => {
		t.fail(`error was emitted: ${err}`);
	});
	await getStream(stream);
	await delay(reqDelay * 3);
	t.pass();
});

test('no error emitted when timeout is not breached (promise)', async t => {
	await got(s.url, {
		retry: 0,
		timeout: {
			request: reqDelay * 2
		}
	}).on('request', req => {
		// 'error' events are not emitted by the Promise interface, so attach
		// directly to the request object
		req.on('error', err => {
			t.fail(`error was emitted: ${err}`);
		});
	});
	await delay(reqDelay * 3);
	t.pass();
});
