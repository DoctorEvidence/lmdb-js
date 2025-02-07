import chai from 'chai';
import path, { dirname } from 'path';
import rimraf from 'rimraf';

let should = chai.should();
let expect = chai.expect;
import { spawn } from 'child_process';
import { unlinkSync } from 'fs';
import { fileURLToPath } from 'url';
import { Worker } from 'worker_threads';
import { encoder as orderedBinaryEncoder } from 'ordered-binary/index.js';
import inspector from 'inspector';
//inspector.open(9229, null, true); debugger
let nativeMethods,
	dirName = dirname(fileURLToPath(import.meta.url));

import { createRequire } from 'module';
import { createBufferForAddress, fs } from '../native.js';
import {
	ABORT,
	IF_EXISTS,
	asBinary,
	bufferToKeyValue,
	keyValueToBuffer,
	levelup,
	open,
	version,
	TIMESTAMP_PLACEHOLDER,
	DIRECT_WRITE_PLACEHOLDER,
} from '../node-index.js';
import { openAsClass } from '../open.js';
import { RangeIterable } from '../util/RangeIterable.js';
const require = createRequire(import.meta.url);
// we don't always test CJS because it messes up debugging in webstorm (and I am not about to give the awesomeness
// that is webstorm debugging)
const { open: openFromCJS } = process.env.TEST_CJS
	? require('../dist/index.cjs')
	: {};

describe('lmdb-js', function () {
	let testDirPath = path.resolve(dirName, './testdata-ls');

	// just to make a reasonable sized chunk of data...
	function expand(str) {
		str = '(' + str + ')';
		str = str + str;
		str = str + str;
		str = str + str;
		str = str + str;
		str = str + str;
		return str;
	}
	before(function (done) {
		// cleanup previous test directory
		rimraf(testDirPath, function (err) {
			if (err) {
				return done(err);
			}
			done();
		});
	});
	let testIteration = 0;
	describe('Basic use', basicTests({}));
	describe(
		'Basic use with overlapping sync',
		basicTests({
			compression: false,
			overlappingSync: true,
			noMemInit: true,
			trackMetrics: true,
			pageSize: 0x2000,
			maxFreeSpaceToLoad: 400,
			maxFreeSpaceToRetain: 100,
		}),
	);
	if (version.patch >= 90) {
		describe(
			'Basic use with encryption',
			basicTests({
				compression: false,
				encryptionKey: 'Use this key to encrypt the data',
			}),
		);
		//describe('Check encrypted data', basicTests({ compression: false, encryptionKey: 'Use this key to encrypt the data', checkLast: true }));
	}
	describe('Basic use with JSON', basicTests({ encoding: 'json' }));
	describe(
		'Basic use with ordered-binary',
		basicTests({ encoding: 'ordered-binary' }),
	);
	if (typeof WeakRef != 'undefined')
		describe(
			'Basic use with caching',
			basicTests({ cache: { validated: true } }),
		);
	function basicTests(options) {
		return function () {
			this.timeout(1000000);
			let db, db2, db3;
			before(function () {
				if (!options.checkLast) testIteration++;
				db = open(
					(options = Object.assign(
						{
							name: 'mydb1',
							create: true,
							useVersions: true,
							batchStartThreshold: 10,
							maxReaders: 100,
							keyEncoder: orderedBinaryEncoder,
							/*compression: {
								threshold: 256,
							},*/
						},
						options,
					)),
				);
				if (!options.checkLast) db.clearSync();
				db2 = db.openDB(
					Object.assign({
						name: 'mydb2',
						create: true,
						dupSort: true,
					}),
				);
				if (!options.checkLast) db2.clearSync();
				db3 = db.openDB({
					name: 'mydb3',
					create: true,
					dupSort: true,
					encoding: 'ordered-binary',
				});
				if (!options.checkLast) db3.clearSync();
			});
			if (options.checkLast) {
				it('encrypted data can not be accessed', function () {
					let data = db.get('key1');
					data.should.deep.equal('test');
				});
				return;
			}
			it('will not open non-existent db with create disabled', function () {
				let noDb = db.open({
					name: 'not-there',
					create: false,
				});
				should.equal(noDb, undefined);
			});
			it('simple open', function () {
				let test = open({}).openDB('foo', {});
			});
			it('zero length values', async function () {
				await db.committed; // should be able to await db even if nothing has happened
				db.put(5, asBinary(Buffer.from([])));
				db.put(5, asBinary(createBufferForAddress(16, 0))); // externally allocated buffers of zero-length with the same non-null-pointer can crash node, #161
				db.put(5, asBinary(createBufferForAddress(16, 0)));
				await db2.put('key1', asBinary(Buffer.from([])));
				should.equal(db.getBinary(5).length, 0);
				should.equal(db2.getBinary('key1').length, 0);
				db.put(5, asBinary(Buffer.from([4])));
				db2.remove('key1');
				await db2.put('key1', asBinary(Buffer.from([4])));
				should.equal(db.getBinary(5).length, 1);
				should.equal(db2.getBinary('key1').length, 1);
				db.put(5, asBinary(Buffer.from([])));
				db2.remove('key1');
				await db2.put('key1', asBinary(Buffer.from([])));
				should.equal(db.getBinary(5).length, 0);
				should.equal(db2.getBinary('key1').length, 0);
				await db2.remove('key1');
			});
			it('query of keys', async function () {
				let keys = [
					Symbol.for('test'),
					false,
					true,
					-33,
					-1.1,
					3.3,
					5,
					[5, 4],
					[5, 55],
					[5, 'words after number'],
					[6, 'abc'],
					['Test', null, 1],
					['Test', Symbol.for('test'), 2],
					['Test', 'not null', 3],
					'hello',
					['hello', 3],
					['hello', 'world'],
					['uid', 'I-7l9ySkD-wAOULIjOEnb', 'Rwsu6gqOw8cqdCZG5_YNF'],
					'z',
				];
				for (let key of keys) {
					await db.put(key, 3);
				}
				let returnedKeys = [];
				for (let { key, value } of db.getRange({
					start: Symbol.for('A'),
				})) {
					returnedKeys.push(key);
					value.should.equal(db.get(key));
				}
				keys.should.deep.equal(returnedKeys);

				returnedKeys = [];
				for (let { key, value } of db.getRange({
					reverse: true,
				})) {
					returnedKeys.unshift(key);
					value.should.equal(db.get(key));
				}
				keys.shift(); // remove the symbol test, it should be omitted
				keys.should.deep.equal(returnedKeys);
			});
			it('reverse query range', async function () {
				const keys = [
					['Test', 100, 1],
					['Test', 10010, 2],
					['Test', 10010, 3],
				];
				for (let key of keys) db.put(key, 3);
				await db.committed;
				for (let { key, value } of db.getRange({
					start: ['Test', null],
					end: ['Test', null],
					reverse: true,
				})) {
					throw new Error('Should not return any results');
				}
			});
			it('more reverse query range', async function () {
				db.putSync(
					'0Sdts8FwTqt2Hv5j9KE7ebjsQcFbYDdL/0Sdtsud6g8YGhPwUK04fRVKhuTywhnx8',
					1,
					1,
					null,
				);
				db.putSync(
					'0Sdts8FwTqt2Hv5j9KE7ebjsQcFbYDdL/0Sdu0mnkm8lS38yIZa4Xte3Q3JUoD84V',
					1,
					1,
					null,
				);
				const options = {
					start:
						'0Sdts8FwTqt2Hv5j9KE7ebjsQcFbYDdL/0SdvKaMkMNPoydWV6HxZbFtKeQm5sqz3',
					end: '0Sdts8FwTqt2Hv5j9KE7ebjsQcFbYDdL/00000000dKZzSn03pte5dWbaYfrZl4hG',
					reverse: true,
				};
				let returnedKeys = Array.from(db.getKeys(options));
				returnedKeys.should.deep.equal([
					'0Sdts8FwTqt2Hv5j9KE7ebjsQcFbYDdL/0Sdu0mnkm8lS38yIZa4Xte3Q3JUoD84V',
					'0Sdts8FwTqt2Hv5j9KE7ebjsQcFbYDdL/0Sdtsud6g8YGhPwUK04fRVKhuTywhnx8',
				]);
			});
			it('clear between puts', async function () {
				db.put('key0', 'zero');
				db.clearAsync();
				await db.put('key1', 'one');
				should.equal(db.get('key0'), undefined);
				should.equal(db.get('hello'), undefined);
				should.equal(db.get('key1'), 'one');
			});
			if (options.trackMetrics)
				it('track metrics', async function () {
					await db.put('key1', 'Hello world!');
					expect(db.getStats().timeDuringTxns).gte(0);
				});
			it('string', async function () {
				await db.put('key1', 'Hello world!');
				let data = db.get('key1');
				data.should.equal('Hello world!');
				await db.remove('key1');
				let data2 = db.get('key1');
				should.equal(data2, undefined);
			});
			it('string with version', async function () {
				await db.put('key1', 'Hello world!', 53252);
				let entry = db.getEntry('key1');
				entry.value.should.equal('Hello world!');
				entry.version.should.equal(53252);
				(await db.remove('key1', 33)).should.equal(false);
				entry = db.getEntry('key1');
				entry.value.should.equal('Hello world!');
				entry.version.should.equal(53252);
				(await db.remove('key1', 53252)).should.equal(true);
				entry = db.getEntry('key1');
				should.equal(entry, undefined);
			});
			it('string with version branching', async function () {
				await db.put('key1', 'Hello world!', 53252);
				let entry = db.getEntry('key1');
				entry.value.should.equal('Hello world!');
				entry.version.should.equal(53252);
				(
					await db.ifVersion('key1', 777, () => {
						db.put('newKey', 'test', 6);
						db2.put('keyB', 'test', 6);
					})
				).should.equal(false);
				should.equal(db.get('newKey'), undefined);
				should.equal(db2.get('keyB'), undefined);
				let result = await db.ifVersion('key1', 53252, () => {
					db.put('newKey', 'test', 6);
					db2.put('keyB', 'test', 6);
				});
				should.equal(db.get('newKey'), 'test');
				should.equal(db2.get('keyB'), 'test');
				should.equal(result, true);
				result = await db.ifNoExists('key1', () => {
					db.put('newKey', 'changed', 7);
				});
				should.equal(db.get('newKey'), 'test');
				should.equal(result, false);
				result = await db.ifNoExists('key-no-exist', () => {
					db.put('newKey', 'changed', 7);
				});
				should.equal(db.get('newKey'), 'changed');
				should.equal(result, true);

				result = await db2.ifVersion('key-no-exist', IF_EXISTS, () => {
					db.put('newKey', 'changed again', 7);
				});
				should.equal(db.get('newKey'), 'changed');
				should.equal(result, false);

				result = await db2.ifVersion('keyB', IF_EXISTS, () => {
					db.put('newKey', 'changed again', 7);
				});
				should.equal(db.get('newKey'), 'changed again');
				should.equal(result, true);

				result = await db2.remove('key-no-exists');
				should.equal(result, true);
				result = await db2.remove('key-no-exists', IF_EXISTS);
				should.equal(result, false);
			});
			it('deep ifVersion', async function () {
				for (let i = 0; i < 4; i++) {
					await db.put('key1', 'Hello world!', 53252);
					let depth = 1000;
					let result;

					function nextIfVersion() {
						result = db.ifVersion('key1', 53252, () => {
							if (depth-- > 0) nextIfVersion();
							else db.put('key1', 'done!', 53253);
						});
					}

					nextIfVersion();
					await result;
					should.equal(db.get('key1'), 'done!');
				}
			});
			if (version.patch >= 90)
				it('repeated ifNoExists', async function () {
					let keyBase =
						'c333f4e0-f692-4bca-ad45-f805923f974f-c333f4e0-f692-4bca-ad45-f805923f974f-c333f4e0-f692-4bca-ad45-f805923f974f';
					let result;
					for (let i = 0; i < 500; i++) {
						let key = keyBase + (i % 100);
						result = db.ifNoExists(keyBase + i, () => {
							db.put(keyBase + i, 'changed', 7);
						});
						if (i % 100 == 0) {
							await result;
						}
					}
					await result;
				});
			it('string with compression and versions', async function () {
				let str = expand('Hello world!');
				await db.put('key1', str, 53252);
				let entry = db.getEntry('key1');
				entry.value.should.equal(str);
				entry.version.should.equal(53252);
				(await db.remove('key1', 33)).should.equal(false);
				let data = db.get('key1');
				data.should.equal(str);
				(await db.remove('key1', 53252)).should.equal(true);
				data = db.get('key1');
				should.equal(data, undefined);
			});
			it('repeated compressions', async function () {
				let str = expand('Hello world!');
				db.put('key1', str, 53252);
				db.put('key1', str, 53253);
				db.put('key1', str, 53254);
				await db.put('key1', str, 53255);
				let entry = db.getEntry('key1');
				entry.value.should.equal(str);
				entry.version.should.equal(53255);
				(await db.remove('key1')).should.equal(true);
			});

			it('forced compression due to starting with 255', async function () {
				await db.put('key1', asBinary(Buffer.from([255])));
				let entry = db.getBinary('key1');
				entry.length.should.equal(1);
				entry[0].should.equal(255);
				(await db.remove('key1')).should.equal(true);
			});
			if (options.encoding == 'ordered-binary') return; // no more tests need to be applied for this
			it('bigger puts, testing free space management', async function () {
				let seed = 15325223;
				function random() {
					return randomInt() / 2038074743;
				}
				function randomInt() {
					seed++;
					let a = seed * 15485863;
					return (a * a * a) % 2038074743;
				}
				//await new Promise((resolve) => setTimeout(resolve, 3000));

				let promise;
				let additive = 'this is more text';
				for (let i = 0; i < 7; i++) additive += additive;
				let read_txn = db.useReadTransaction();
				for (let i = 0; i < 5000; i++) {
					if (Math.random() < 0.3) {
						read_txn.done();
						read_txn = db.useReadTransaction();
					}
					let text = 'this is a test';
					while (random() < 0.95) text += additive;
					if (random() < 0.4) promise = db.remove(i % 40);
					else promise = db.put(i % 40, text);
					if (random() < 0.05) {
						await promise;
					}
				}
				await promise;
			});

			it('store objects', async function () {
				let dataIn = { foo: 3, bar: true };
				await db.put('key1', dataIn);
				let dataOut = db.get('key1');
				dataOut.should.deep.equal(dataIn);
				db.removeSync('not-there').should.equal(false);
			});
			it('store binary', async function () {
				let dataIn = { foo: 4, bar: true };
				let buffer = db.encoder.encode(dataIn);
				if (typeof buffer == 'string') return;
				await db.put('key1', asBinary(buffer));
				let dataOut = db.get('key1');
				dataOut.should.deep.equal(dataIn);
			});
			it('writes batch with callback', async function () {
				let dataIn = { name: 'for batch 1' };
				await db.batch(() => {
					db.put('key1', dataIn);
					db.put('key2', dataIn);
				});
			});
			it('conditional put', async function () {
				if (db.encoding == 'ordered-binary') return;
				const key = 'test';
				await db.put(key, { a: 1, b: 2 }, 1);
				db.getEntry(key);
				await db.put(key, { a: 2, b: 3 }, 2, 1);
				const entry2 = db.get(key);
				should.equal(entry2.a, 2);
			});
			it.skip('trigger sync commit', async function () {
				let dataIn = { foo: 4, bar: false };
				db.immediateBatchThreshold = 1;
				db.syncBatchThreshold = 1;
				await db.put('key1', dataIn);
				await db.put('key2', dataIn);
				db.immediateBatchThreshold = 100000;
				db.syncBatchThreshold = 1000000;
				let dataOut = db.get('key1');
				dataOut.should.deep.equal(dataIn);
			});
			function iterateQuery(acrossTransactions) {
				return async () => {
					let data1 = { foo: 1, bar: true };
					let data2 = { foo: 2, bar: false };
					db.put('key1', data1);
					db.put('key2', data2);
					await db.committed;
					let count = 0;
					for (let { key, value } of db.getRange({
						start: 'key',
						end: 'keyz',
						snapshot: !acrossTransactions,
					})) {
						if (acrossTransactions) await delay(10);
						count++;
						switch (key) {
							case 'key1':
								data1.should.deep.equal(value);
								break;
							case 'key2':
								data2.should.deep.equal(value);
								break;
						}
					}
					should.equal(count >= 2, true);
					should.equal(db.getCount({ start: 'key', end: 'keyz' }) >= 2, true);
				};
			}
			it('should iterate over query', iterateQuery(false));
			it('should iterate over query, across transactions', iterateQuery(true));
			it('should break out of query', async function () {
				let data1 = { foo: 1, bar: true };
				let data2 = { foo: 2, bar: false };
				db.put('key1', data1);
				db.put('key2', data2);
				await db.committed;
				let count = 0;
				for (let { key, value } of db.getRange({ start: 'key', end: 'keyz' })) {
					if (count > 0) break;
					count++;
					data1.should.deep.equal(value);
					'key1'.should.equal(key);
				}
				count.should.equal(1);
			});
			it('forEach and filter', async function () {
				let data1 = { foo: 1, bar: true };
				let data2 = { foo: 2, bar: false };
				db.put('key1', data1);
				db.put('key2', data2);
				await db.committed;
				let count = 0;
				db.getRange({ start: 'key', end: 'keyz' }).forEach((entry) => {
					count++;
				});
				count.should.equal(2);
				count = 0;
				db.getRange({ start: 'key', end: 'keyz' })
					.filter(() => true)
					.forEach((entry) => {
						count++;
					});
				count.should.equal(2);
			});
			it('getRange with arrays', async function () {
				const keys = [
					['foo', 0],
					['foo', 1],
					['foo', 2],
				];
				let promise;
				keys.forEach((key, i) => {
					promise = db.put(key, i);
				});
				await promise;

				let result = Array.from(
					db.getRange({
						start: ['foo'],
						end: ['foo', 1],
					}),
				);
				result.should.deep.equal([{ key: ['foo', 0], value: 0 }]);

				result = Array.from(
					db.getRange({
						start: ['foo', 0],
						end: ['foo', 1],
					}),
				);
				result.should.deep.equal([{ key: ['foo', 0], value: 0 }]);

				result = Array.from(
					db.getRange({
						start: ['foo', 2],
						end: ['foo', [2, null]],
					}),
				);
				result.should.deep.equal([{ key: ['foo', 2], value: 2 }]);
			});
			it('should iterate over query with offset/limit', async function () {
				let data1 = { foo: 1, bar: true };
				let data2 = { foo: 2, bar: false };
				let data3 = { foo: 3, bar: false };
				db.put('key1', data1);
				db.put('key2', data2);
				await db.put('key3', data3);
				let count = 0;
				for (let { key, value } of db.getRange({
					start: 'key',
					end: 'keyz',
					offset: 1,
					limit: 1,
				})) {
					count++;
					switch (key) {
						case 'key2':
							data2.should.deep.equal(value);
							break;
					}
				}
				count.should.equal(1);
				count = 0;
				for (let { key, value } of db.getRange({
					start: 'key',
					end: 'keyz',
					offset: 3,
					limit: 3,
				})) {
					count++;
				}
				count.should.equal(0);
				for (let { key, value } of db.getRange({
					start: 'key',
					end: 'keyz',
					offset: 10,
					limit: 3,
				})) {
					count++;
				}
				count.should.equal(0);
				for (let { key, value } of db.getRange({
					start: 'key',
					end: 'keyz',
					offset: 2,
					limit: 3,
				})) {
					count++;
					switch (key) {
						case 'key3':
							data3.should.deep.equal(value);
							break;
					}
				}
				count.should.equal(1);
			});
			it('should iterate over query with inclusiveEnd/exclusiveStart', async function () {
				let data1 = { foo: 1, bar: true };
				let data2 = { foo: 2, bar: false };
				let data3 = { foo: 3, bar: false };
				db.put('key1', data1);
				db.put('key2', data2);
				await db.put('key3', data3);
				let results = Array.from(db.getRange({ start: 'key1', end: 'key3' }));
				results.length.should.equal(2);
				results = Array.from(
					db.getRange({ start: 'key1', end: 'key3', inclusiveEnd: true }),
				);
				results.length.should.equal(3);
				results = Array.from(
					db.getRange({ start: 'key1', end: 'key3', exclusiveStart: true }),
				);
				results.length.should.equal(1);
				results = Array.from(
					db.getRange({
						start: 'key1',
						end: 'key3',
						inclusiveEnd: true,
						exclusiveStart: true,
					}),
				);
				results.length.should.equal(2);
			});
			it('should handle open iterators and cursor renewal', async function () {
				let data1 = { foo: 1, bar: true };
				let data2 = { foo: 2, bar: false };
				let data3 = { foo: 3, bar: false };
				db2.put('key1', data1);
				db.put('key1', data1);
				db.put('key2', data2);
				await db.put('key3', data3);
				let it1 = db.getRange({ start: 'key', end: 'keyz' })[Symbol.iterator]();
				let it2 = db2
					.getRange({ start: 'key', end: 'keyz' })
					[Symbol.iterator]();
				let it3 = db.getRange({ start: 'key', end: 'keyz' })[Symbol.iterator]();
				it1.return();
				it2.return();
				await new Promise((resolve) => setTimeout(resolve, 10));
				it1 = db.getRange({ start: 'key', end: 'keyz' })[Symbol.iterator]();
				it2 = db2.getRange({ start: 'key', end: 'keyz' })[Symbol.iterator]();
				let it4 = db.getRange({ start: 'key', end: 'keyz' })[Symbol.iterator]();
				let it5 = db2
					.getRange({ start: 'key', end: 'keyz' })
					[Symbol.iterator]();
				await new Promise((resolve) => setTimeout(resolve, 20));
				it4.return();
				it5.return();
				it1.return();
				it2.return();
				it3.return();
			});
			it('should iterate over dupsort query, with removal', async function () {
				let data1 = { foo: 1, bar: true };
				let data2 = { foo: 2, bar: false };
				let data3 = { foo: 3, bar: true };
				db2.put('key1', data1);
				db2.put('key1', data2);
				db2.put('key1', data3);
				await db2.put('key2', data3);
				let count = 0;
				for (let value of db2.getValues('key1')) {
					count++;
					switch (count) {
						case 1:
							data1.should.deep.equal(value);
							break;
						case 2:
							data2.should.deep.equal(value);
							break;
						case 3:
							data3.should.deep.equal(value);
							break;
					}
				}
				count.should.equal(3);
				db2.getValuesCount('key1').should.equal(3);
				await db2.remove('key1', data2);
				count = 0;
				for (let value of db2.getValues('key1')) {
					count++;
					switch (count) {
						case 1:
							data1.should.deep.equal(value);
							break;
						case 2:
							data3.should.deep.equal(value);
							break;
					}
				}
				count.should.equal(2);
				db2.getValuesCount('key1').should.equal(2);
				count = 0;
				for (let value of db2.getValues('key1', { reverse: true })) {
					count++;
					switch (count) {
						case 1:
							data3.should.deep.equal(value);
							break;
						case 2:
							data1.should.deep.equal(value);
							break;
					}
				}
				count.should.equal(2);
				db2.getValuesCount('key1').should.equal(2);

				count = 0;
				for (let value of db2.getValues('key0')) {
					count++;
				}
				count.should.equal(0);
				db2.getValuesCount('key0').should.equal(0);
				db2.getCount({ start: 'key1', end: 'key3' }).should.equal(3);
			});
			it('should iterate over ordered-binary dupsort query with start/end', async function () {
				db3.put('key1', 1);
				db3.put('key1', 2);
				db3.put('key1', 3);
				await db3.put('key2', 3);
				let count = 0;
				for (let value of db3.getValues('key1', { start: 1 })) {
					count++;
					value.should.equal(count);
				}
				count.should.equal(3);
				count = 0;
				for (let value of db3.getValues('key1', { end: 3 })) {
					count++;
					value.should.equal(count);
				}
				count.should.equal(2);
			});
			it('should count ordered-binary dupsort query with start/end', async function () {
				db3.put('key1', 1);
				db3.put('key1', 2);
				db3.put('key1', 3);
				await db3.put('key2', 3);
				db3.getValuesCount('key1').should.equal(3);
				db3.getValuesCount('key1', { start: 1, end: 3 }).should.equal(2);
				db3.getValuesCount('key1', { start: 2, end: 3 }).should.equal(1);
				db3.getValuesCount('key1', { start: 2 }).should.equal(2);
				db3.getValuesCount('key1', { end: 2 }).should.equal(1);
				db3.getValuesCount('key1', { start: 1, end: 2 }).should.equal(1);
				db3.getValuesCount('key1', { start: 2, end: 2 }).should.equal(0);
				db3.getValuesCount('key1').should.equal(3);
			});
			it('should reverse iterate ordered-binary dupsort query with start/end', async function () {
				db3.put('key1', 1);
				db3.put('key1', 2);
				db3.put('key1', 3);
				await db3.put('key2', 3);
				let count = 0;
				for (let value of db3.getValues('key1', { reverse: true, start: 2 })) {
					count++;
					value.should.equal(3 - count);
				}
				count.should.equal(2);

				count = 0;
				for (let value of db3.getValues('key1', {
					reverse: true,
					start: 2.5,
				})) {
					count++;
					value.should.equal(3 - count);
				}
				count.should.equal(2);

				count = 0;
				for (let value of db3.getValues('key1', { reverse: true, start: 50 })) {
					count++;
					value.should.equal(4 - count);
				}
				count.should.equal(3);

				count = 0;
				for (let value of db3.getValues('key1', {
					reverse: true,
					start: 2,
					end: 1,
				})) {
					count++;
					value.should.equal(3 - count);
				}
				count.should.equal(1);

				count = 0;
				for (let value of db3.getValues('key1', { reverse: true, end: 1 })) {
					count++;
					value.should.equal(4 - count);
				}
				count.should.equal(2);

				count = 0;
				for (let value of db3.getValues('key1', {
					reverse: true,
					start: 0.5,
				})) {
					count++;
				}
				count.should.equal(0);
			});
			it('doesExist', async function () {
				should.equal(db.doesExist('does-exist-test'), false);
				if (db.isCaching) {
					db.put('does-exist-test', true);
					should.equal(db.doesExist('does-exist-test'), true);
				}
				await db.put('does-exist-test', true);
				should.equal(db.doesExist('does-exist-test'), true);
				should.equal(db2.doesExist('not-there'), false);
				let data1 = { foo: 1, bar: true };
				let data2 = { foo: 2, bar: false };
				let data3 = { foo: 3, bar: true };
				db2.put('key1', data1);
				db2.put('key1', data3);
				db2.put(false, 3);
				await db2.put('key2', data3);
				should.equal(db2.doesExist('key1'), true);
				should.equal(db2.doesExist('key1', data1), true);
				should.equal(db2.doesExist('key1', data2), false);
				should.equal(db2.doesExist('key1', data3), true);
				should.equal(db2.doesExist(false), true);
				should.equal(db2.doesExist(false, 3), true);
				should.equal(db2.doesExist(false, 4), false);
			});
			it('should iterate over keys without duplicates', async function () {
				let lastKey;
				for (let key of db2.getKeys({ start: 'k' })) {
					if (key == lastKey) throw new Error('duplicate key returned');
					lastKey = key;
				}
			});
			it('big keys', async function () {
				let keyBase = '';
				for (let i = 0; i < 1900; i++) {
					keyBase += 'A';
				}
				let keys = [];
				let promise;
				for (let i = 40; i < 120; i++) {
					let key = String.fromCharCode(i) + keyBase;
					keys.push(key);
					promise = db.put(key, i);
				}
				await promise;
				let returnedKeys = [];
				for (let { key, value } of db.getRange({})) {
					if (key.length > 1000) {
						returnedKeys.push(key);
						should.equal(key.charCodeAt(0), value);
						should.equal(db.get(key), value);
						promise = db.remove(key);
					}
				}
				returnedKeys.should.deep.equal(keys);
				await promise;
				should.equal(db.get(returnedKeys[0]), undefined);
			});
			if (!options.encryptionKey)
				it('getAsync', async function () {
					for (let i = 0; i < 200; i++) {
						db.put('async' + i, 'value' + i);
					}
					await db.committed;
					let gets = [];
					for (let i = 0; i < 200; i++) {
						gets.push(db.getAsync('async' + i));
					}
					let results = await Promise.all(gets);
					for (let i = 0; i < 200; i++) {
						should.equal(results[i], 'value' + i);
					}
				});
			it('getUserSharedBuffer', function () {
				let defaultIncrementer = new BigInt64Array(1);
				let incrementer = new BigInt64Array(
					db.getUserSharedBuffer('incrementer-test', defaultIncrementer.buffer),
				);
				incrementer[0] = 4n;
				should.equal(Atomics.add(incrementer, 0, 1n), 4n);
				let secondDefaultIncrementer = new BigInt64Array(1); //should not get used
				let nextIncrementer = new BigInt64Array( // should return same incrementer
					db.getUserSharedBuffer(
						'incrementer-test',
						secondDefaultIncrementer.buffer,
					),
				);
				should.equal(incrementer[0], 5n);
				should.equal(Atomics.add(nextIncrementer, 0, 1n), 5n);
				should.equal(incrementer[0], 6n);
				should.equal(secondDefaultIncrementer[0], 0n);
			});
			it('getUserSharedBuffer with callbacks', async function () {
				let shared_number = new Float64Array(1);
				let notified;
				let shared_buffer;
				await new Promise((resolve) => {
					shared_buffer = db.getUserSharedBuffer(
						'with-callback',
						shared_number.buffer,
						{
							callback() {
								resolve();
							},
						},
					);
					shared_buffer.notify();
				});
			});
			it('committed event', async function () {
				await new Promise((resolve) => {
					db.put(5, { name: 'test committed event' });
					db.on('committed', resolve);
				});
			});

			it('prefetch', async function () {
				await new Promise((resolve) => db.prefetch(['key1', 'key2'], resolve));
				let key = '';
				for (let i = 0; i < 1900; i++) {
					key += 'A';
				}
				let keys = [];
				for (let i = 0; i < 20; i++) {
					keys.push(key);
				}
				let value = keys.join(',');
				await db.put(key, value);
				await db.prefetch(keys);
				let values = await db.getMany(keys);
				should.equal(values.length, 20);
				should.equal(values[3], value);
				values = await db.getMany([]);
				should.equal(values.length, 0);
				await db3.put('key13333', 3);
				await db3.put('key133333', 4);
				await db3.prefetch([
					{ key: 'key13333', value: 3 },
					{ key: 'key133333', value: 4 },
				]);
			});

			it('invalid key', async function () {
				expect(() => db.get(Buffer.from([]))).to.throw();
				expect(() => db.put(Buffer.from([]), 'test')).to.throw();
				//expect(() => db.get({ foo: 'bar' })).to.throw();
				//expect(() => db.put({ foo: 'bar' }, 'hello')).to.throw();
				expect(() => db.put('x'.repeat(4027), 'hello')).to.throw();
				expect(() => db2.put('x', 'x'.repeat(4027))).to.throw();
				Array.from(db.getRange({ start: 'x', end: Buffer.from([]) }));
				//expect(() => Array.from(db.getRange({ start: 'x'.repeat(4027)}))).to.throw();
			});
			it('put options (sync)', function () {
				db.putSync('zkey6', 'test', { append: true, version: 33 });
				let entry = db.getEntry('zkey6');
				entry.value.should.equal('test');
				entry.version.should.equal(33);
				should.equal(
					db.putSync('zkey7', 'test', { append: true, noOverwrite: true }),
					true,
				);
				should.equal(db2.putSync('zkey6', 'test1', { appendDup: true }), true);
				should.equal(db2.putSync('zkey6', 'test2', { appendDup: true }), true);
				should.equal(
					db.putSync('zkey5', 'test', { append: true, version: 44 }),
					false,
				);
				should.equal(db.putSync('zkey7', 'test', { noOverwrite: true }), false);
				should.equal(db2.putSync('zkey6', 'test1', { noDupData: true }), false);
			});
			it('use read transaction', async function () {
				await db.put('key1', 1);
				let transaction = db.useReadTransaction();
				await db.put('key1', 2);
				should.equal(db.get('key1', { transaction }), 1);
				should.equal(db.get('key1', {}), 2);
				await db.put('key1', 3);
				should.equal(db.get('key1', { transaction }), 1);
				transaction.done();
			});
			it('async transactions', async function () {
				let ranTransaction;
				db.put('key1', 'async initial value'); // should be queued for async write, but should put before queued transaction
				let errorHandled;
				db.childTransaction(() => {
					db.put('key1', 'should be rolled back');
					throw new Error(
						'Make sure this is properly propagated without interfering with next transaction',
					);
				}).catch((error) => {
					if (error) errorHandled = true;
				});
				await db.childTransaction(() => {
					should.equal(db.get('key1'), 'async initial value');
					db.put('key-a', 'async test a');
					should.equal(db.get('key-a'), 'async test a');
				});
				should.equal(errorHandled, true);
				await db.transactionAsync(() => {
					ranTransaction = true;
					should.equal(db.get('key1'), 'async initial value');
					db.put('key1', 'async test 1');
					should.equal(db.get('key1'), 'async test 1');
					for (let { key, value } of db.getRange({
						start: 'key1',
						end: 'key1z',
					})) {
						should.equal(value, 'async test 1');
					}
					db2.put('key2-async', 'async test 2');
					should.equal(db2.get('key2-async'), 'async test 2');
					expect(db.getWriteTxnId()).gte(1);
				});
				should.equal(db.get('key1'), 'async test 1');
				should.equal(db2.get('key2-async'), 'async test 2');
				should.equal(ranTransaction, true);
			});
			it('async transactions with async callbacks', async function () {
				let reportedError;
				let order = [];
				let promiseWithError = db
					.transaction(async () => {
						await new Promise((resolve) => setTimeout(resolve, 1));
						db.put('key1', 'async test 2');
						order.push(0);
						throw new Error('test');
					})
					.then(
						() => {
							console.error('should not get here');
						},
						(error) => (reportedError = error),
					);
				let promiseWithDelay = db.transaction(async () => {
					order.push(1);
					await delay(20);
					order.push(2);
					db.put('key2', 'async test 2');
					return 2;
				});
				await delay(1);
				let promise = db.transaction(async () => {
					await delay(1);
					order.push(3);
					db.put('key3', 'async test 2');
					return 3;
				});
				let promise2 = db.transaction(async () => {
					await delay(1);
					order.push(4);
					db.put('key3', 'async test 2');
					return 4;
				});
				await delay(5);
				let promiseError = db.transaction(async () => {
					throw new Error('test2');
				});
				let promise3 = db.transaction(async () => {
					await delay(1);
					order.push(5);
					return 5;
				});
				should.equal(await promise3, 5);
				order.should.deep.equal([0, 1, 2, 3, 4, 5]);
				should.equal(await promise2, 4);
				await db.committed;
				await promiseWithDelay;
				should.equal(db.get('key1'), 'async test 2');
				should.equal(db.get('key2'), 'async test 2');
				should.equal(db.get('key3'), 'async test 2');
				reportedError.message.should.equal('test');
				should.equal(await promiseWithDelay, 2);
				should.equal(await promise, 3);
				try {
					await promiseError;
					throw new Error('should not get here');
				} catch (error) {
					should.equal(error.message, 'test2');
				}
			});
			it('child transaction in sync transaction', async function () {
				await db.transactionSync(async () => {
					db.put('key3', 'test-sync-txn');
					db.childTransaction(() => {
						db.put('key3', 'test-child-txn');
						return ABORT;
					});
					should.equal(db.get('key3'), 'test-sync-txn');
					db.childTransaction(() => {
						db.put('key3', 'test-child-txn');
					});
					should.equal(db.get('key3'), 'test-child-txn');
					await db.childTransaction(async () => {
						await delay(1);
						db.put('key3', 'test-async-child-txn');
					});
					should.equal(db.get('key3'), 'test-async-child-txn');
				});
				await db.transactionSync(async () => {
					await delay(1);
					// no await, but ensure this delays the parent txn
					db.transactionSync(async () => {
						await delay(1);
						db.put('key3', 'child-after-delay');
						db.transactionSync(async () => {
							await delay(1);
							db.put('key3', 'child-after-delay2');
							db.transactionSync(async () => {
								await delay(1);
								db.put('key3', 'child-after-delay3');
							});
						});
					});
					db.put('key3', 'after-child-start');
				});
				should.equal(db.get('key3'), 'child-after-delay3');
			});
			it('async transaction with interrupting sync transaction default order', async function () {
				for (let i = 0; i < 10; i++) {
					db.strictAsyncOrder = true;
					let order = [];
					let ranSyncTxn;
					db.transactionAsync(() => {
						order.push('a1');
						db.put('async1', 'test');
						if (!ranSyncTxn) {
							ranSyncTxn = true;
							setImmediate(() => {
								db.transactionSync(() => {
									order.push('s1');
									db.put('inside-sync', 'test');
								});
							});
						}
					});
					db.put('outside-txn', 'test');
					await db.transactionAsync(() => {
						order.push('a2');
						db.put('async2', 'test');
					});
					order[0].should.equal('a1');
					order.should.include('s1');
					order.should.include('a2');
					should.equal(db.get('async1'), 'test');
					should.equal(db.get('outside-txn'), 'test');
					should.equal(db.get('inside-sync'), 'test');
					should.equal(db.get('async2'), 'test');
				}
			});
			it('multiple async mixed', async function () {
				let result;
				for (let i = 0; i < 100; i++) {
					if (i % 4 < 3) {
						if (i % 8 == 1) {
							let sync = () =>
								db.transactionSync(() => {
									db.put('foo' + i, i);
								});
							if (i % 16 == 1) setImmediate(sync);
							else sync();
							continue;
						}
						db.strictAsyncOrder = i % 4 == 2;
						result = db.transaction(() => {
							db.put('foo' + i, i);
						});
					} else {
						result = db.put('foo' + i, i);
					}
				}
				await result;
				for (let i = 0; i < 100; i++) {
					should.equal(db.get('foo' + i), i);
				}
			});
			it('async transaction with ifNoExists', async function () {
				let key = 'test-exist';
				function addKey(key, name) {
					db.get(key); // { test }
					db.put(key, { name });
					db.get(key); // { test2 }
				}
				await db.put(key, { name: 'first value' });
				let exists;
				await db.transaction(async () => {
					exists = await db.ifNoExists(key, () => addKey(key, 'test2')); // regardless if exists resolves to true or false, it is still changing name from test to test2.
				});
				should.equal(exists, false);
			});
			it('big child transactions', async function () {
				let ranTransaction;
				db.put('key1', 'async initial value'); // should be queued for async write, but should put before queued transaction
				let errorHandled;
				if (!db.cache) {
					db.childTransaction(() => {
						let value;
						for (let i = 0; i < 5000; i++) {
							db.put('key' + i, 'test');
						}
					});
					await db.put('key1', 'test');
					should.equal(db.get('key1'), 'test');
				}
			});
			it('handle write transaction with hanging cursors', async function () {
				db.put('c1', 'value1');
				db.put('c2', 'value2');
				db.put('c3', 'value3');
				await db.committed;
				let iterator;
				db.transactionSync(() => {
					if (db.cache) {
						iterator = db.getRange({ start: 'c1' })[Symbol.iterator]();
						should.equal(iterator.next().value.value, 'value1');
					} else {
						db.childTransaction(() => {
							iterator = db.getRange({ start: 'c1' })[Symbol.iterator]();
							should.equal(iterator.next().value.value, 'value1');
							expect(db.getWriteTxnId()).gte(1);
						});
					}
					should.equal(iterator.next().value.value, 'value2');
					expect(db.getWriteTxnId()).gte(1);
				});
				should.equal(iterator.next().value.value, 'value3');
			});
			it('mixed batches', async function () {
				let promise;
				for (let i = 0; i < 20; i++) {
					db.put(i, 'test');
					promise = db.batch(() => {
						for (let j = 0; j < 20; j++) {
							db.put('test:' + i + '/' + j, i + j);
						}
					});
				}
				await promise;
				for (let i = 0; i < 20; i++) {
					should.equal(db.get(i), 'test');
					for (let j = 0; j < 20; j++) {
						should.equal(db.get('test:' + i + '/' + j), i + j);
					}
				}
			});
			it('levelup style callback', function (done) {
				should.equal(db.isOperational(), true);
				should.equal(db.status, 'open');
				should.equal(db.supports.permanence, true);
				db.put('key1', '1', (error, result) => {
					should.equal(error, null);
					'1'.should.equal(db.get('key1'));
					db.del('key1', (error, result) => {
						should.equal(error, null);
						let leveldb = levelup(db);
						leveldb.get('key1', (error, value) => {
							should.equal(error.name, 'NotFoundError');
							leveldb.put('key1', 'test', (error, value) => {
								leveldb.getMany(['key1'], (error, values) => {
									should.equal('test', values[0]);
									done();
								});
							});
						});
					});
				});
			});
			it('batch operations', async function () {
				let batch = db.batch();
				batch.put('test:z', 'z');
				batch.clear();
				batch.put('test:a', 'a');
				batch.put('test:b', 'b');
				batch.put('test:c', 'c');
				batch.del('test:c');
				let callbacked;
				await batch.write(() => {
					callbacked = true;
				});
				should.equal(callbacked, true);
				should.equal(db.get('test:a'), 'a');
				should.equal(db.get('test:b'), 'b');
				should.equal(db.get('test:c'), undefined);
				should.equal(db.get('test:d'), undefined);
			});
			it('batch array', async function () {
				await db.batch([
					{ type: 'put', key: 'test:a', value: 1 },
					{ type: 'put', key: 'test:b', value: 2 },
					{ type: 'put', key: 'test:c', value: 3 },
					{ type: 'del', key: 'test:c' },
				]);
				should.equal(db.get('test:a'), 1);
				should.equal(db.get('test:b'), 2);
				should.equal(db.get('test:c'), undefined);
			});
			it('read and write with binary encoding', async function () {
				should.equal(db.getString('not-there'), undefined);
				let dbBinary = db.openDB(
					Object.assign({
						name: 'mydb5',
						encoding: 'binary',
					}),
				);
				should.equal(dbBinary.getString('not-there'), undefined);
				dbBinary.put('buffer', Buffer.from('hello'));
				dbBinary.put('empty', Buffer.from([]));
				let big = new Uint8Array(0x21000);
				big.fill(3);
				dbBinary.put('big', big);
				dbBinary.put('big1', big);
				dbBinary.put('big2', big);
				let promise = dbBinary.put('Uint8Array', new Uint8Array([1, 2, 3]));
				await promise;
				await promise.flushed;
				dbBinary.get('big')[3].should.equal(3);
				dbBinary.get('buffer').toString().should.equal('hello');
				dbBinary.get('big')[3].should.equal(3);
				dbBinary.get('Uint8Array')[1].should.equal(2);
				dbBinary.get('empty').length.should.equal(0);

				dbBinary.get('big')[3].should.equal(3);
				dbBinary.get('big')[3].should.equal(3);
				for (let i = 0; i < 100; i++) {
					dbBinary.getBinaryFast('big')[3].should.equal(3);
					dbBinary.getBinaryFast('big1')[3].should.equal(3);
					dbBinary.getBinaryFast('big2')[3].should.equal(3);
					let a;
					for (let j = 0; j < 100000; j++) {
						a = {};
					}
					await delay(1);
				}
				dbBinary.getBinaryFast('big')[3].should.equal(3); // do it twice to test detach the previous one
				dbBinary.get('Uint8Array')[1].should.equal(2);
				Array.from(
					dbBinary.getRange({ start: 'big' }),
				)[0].value[3].should.equal(3);
				Array.from(
					dbBinary.getRange({ start: 'big' }),
				)[0].value[3].should.equal(3);
			});
			it('read and write with binary encoding of key and value', async function () {
				let dbBinary = db.openDB({
					name: 'mydb-binary',
					encoding: 'binary',
					keyEncoding: 'binary',
				});

				let k = Buffer.from('key');
				let v = Buffer.from('value');

				await dbBinary.put(k, v);
				let count = 0;
				for (let { key, value } of dbBinary.getRange({})) {
					should.equal(key.constructor, Buffer);
					should.equal(key.length, 3);
					should.equal(value.constructor, Buffer);
					should.equal(value.length, 5);
					count++;
				}
				should.equal(count, 1);
			});
			it.skip('large txn', async function () {
				while (true) {
					for (let i = 0; i < 5000000; i++) {
						db.put(i, i);
					}
					await db.committed;
					await db.clearAsync();
				}
			});
			it('clearAsync with different keys', async function () {
				let binDb = db.openDB({
					name: 'binary-key',
					keyEncoding: 'binary',
				});
				await binDb.clearAsync();
				let numDb = db.openDB({
					name: 'binary-key',
					keyEncoding: 'uint32',
				});
				await numDb.clearAsync();
			});
			it('use random access structures with retain', async function () {
				let dbRAS = db.openDB(
					Object.assign({
						name: 'random-access',
						randomAccessStructure: true,
						sharedStructuresKey: Symbol('shared-structure'),
					}),
				);
				await dbRAS.put(1, {
					id: 1,
					name: 'one',
				});
				let text = 'hello-world';
				for (let i = 0; i < 13; i++) {
					text += text;
				}
				await dbRAS.put(2, {
					id: 2,
					name: 'two',
					text,
				});
				await dbRAS.put(3, {
					id: 3,
					name: 'three',
				});
				let one = dbRAS.get(1, { lazy: true });
				dbRAS.retain(one);
				let two = dbRAS.get(2, { lazy: true });
				dbRAS.retain(two);
				let three = dbRAS.get(3, { lazy: true });
				dbRAS.retain(three);
				should.equal(one.name, 'one');
				should.equal(two.name, 'two');
				should.equal(three.name, 'three');
				await dbRAS.close();
			});

			it('larger buffers, retained', async function () {
				let index = 1,
					mult = 640;
				index = 1;
				let results = [];
				while (index++ < 80) {
					const newBuff = Buffer.alloc(index * mult);
					await db.put('test-key' + index, newBuff);
					db.retain(db.getBinaryFast('test-key' + index));
					let buffer = db.getBinary('test-key' + index);
					should.equal(Buffer.isBuffer(buffer), true);
				}
			});
			it('larger buffers from write txn', async function () {
				let index = 1,
					mult = 640;
				index = 1;
				let results = [];
				db.transactionSync(() => {
					while (index++ < 80) {
						const newBuff = Buffer.alloc(index * mult);
						db.put('test-key' + index, newBuff);
						db.getBinaryFast('test-key' + index);
					}
				});
			});
			it('concurrent txns', async function () {
				const CONCURRENCY = 20; // macos has a limit of 10 robust/SEM_UNDO semaphores, so this exercises handling that
				let finishedTxns = [];
				for (let i = 0; i < CONCURRENCY; i++) {
					let db = open();
					finishedTxns.push(
						db.transaction(
							() =>
								new Promise((resolve) => {
									setTimeout(resolve, 100);
								}),
						),
					);
				}
				await Promise.all(finishedTxns);
			});

			it('assign timestamps', async function () {
				let dbBinary = db.openDB(
					Object.assign({
						name: 'mydb-timestamp',
						encoding: 'binary',
					}),
				);
				let value = Buffer.alloc(16, 3);
				value.set(TIMESTAMP_PLACEHOLDER);
				value[4] = 0;
				await dbBinary.put(1, value, {
					instructedWrite: true,
				});
				let returnedValue = dbBinary.get(1);
				let dataView = new DataView(returnedValue.buffer, 0, 16);
				let assignedTimestamp = dataView.getFloat64(0);
				should.equal(assignedTimestamp + 100000 > Date.now(), true);
				should.equal(assignedTimestamp - 100000 < Date.now(), true);
				should.equal(returnedValue[9], 3);

				value = Buffer.alloc(16, 3);
				value.set(TIMESTAMP_PLACEHOLDER);
				value[4] = 1; // assign previous

				await dbBinary.put(1, value, {
					instructedWrite: true,
				});
				returnedValue = dbBinary.get(1);
				dataView = new DataView(returnedValue.buffer, 0, 16);
				should.equal(assignedTimestamp, dataView.getFloat64(0));
				should.equal(returnedValue[9], 3);
			});

			it('lock/unlock notifications', async function () {
				let listener_called = 0;
				should.equal(
					db.attemptLock(3.2, 55555, () => {
						listener_called++;
					}),
					true,
				);
				should.equal(
					db.attemptLock(3.2, 55555, () => {
						listener_called++;
					}),
					false,
				);
				let finished_locks = new Promise((resolve) => {
					should.equal(
						db.attemptLock(3.2, 55555, () => {
							listener_called++;
							resolve();
						}),
						false,
					);
				});
				should.equal(db.hasLock('hi', 55555), false);
				should.equal(db.hasLock(3.2, 3), false);
				should.equal(db.hasLock(3.2, 55555), true);
				should.equal(db.hasLock(3.2, 55555), true);
				should.equal(db.unlock(3.2, 55555), true);
				should.equal(db.hasLock(3.2, 55555), false);
				await finished_locks;
				should.equal(listener_called, 2);
				should.equal(db.hasLock(3.2, 55555), false);
			});

			it('lock/unlock with worker', async function () {
				let listener_called = 0;
				should.equal(
					db.attemptLock(4, 1, () => {
						listener_called++;
					}),
					true,
				);
				let worker = new Worker('./test/lock-test.js', {
					workerData: {
						path: db.path,
					},
				});
				let onworkerlock, onworkerunlock;
				worker.on('error', (error) => {
					console.log(error);
				});
				await new Promise((resolve, reject) => {
					worker.on('error', (error) => {
						reject(error);
					});
					worker.on('message', (event) => {
						if (event.started) {
							should.equal(event.hasLock, true);
							resolve();
						}
						if (event.locked) onworkerlock();
						//if (event.unlocked) onworkerunlock();
					});
				});
				db.unlock(4, 1);
				await new Promise((resolve) => {
					onworkerlock = resolve;
				});
				should.equal(
					db.attemptLock(4, 1, () => {
						listener_called++;
						onworkerunlock();
					}),
					false,
				);
				worker.postMessage({ unlock: true });
				await new Promise((resolve) => {
					onworkerunlock = resolve;
				});
				should.equal(listener_called, 1);
				worker.postMessage({ lock: true });
				await new Promise((resolve) => {
					onworkerlock = resolve;
				});
				await new Promise((resolve) => {
					should.equal(
						db.attemptLock(4, 1, () => {
							listener_called++;
							should.equal(listener_called, 2);
							resolve();
						}),
						false,
					);
					worker.terminate();
				});
			});

			it('direct write', async function () {
				let dbBinary = db.openDB(
					Object.assign({
						name: 'mydb-direct',
						encoding: 'binary',
						compression: {
							// options.trackMetrics: true,
							threshold: 40,
							startingOffset: 16,
						},
					}),
				);
				let value = Buffer.alloc(100, 4);
				await dbBinary.put(1, value, {
					instructedWrite: true,
				});

				// this should usually accomplish in-place write
				let returnedValue = dbBinary.get(1);
				should.equal(returnedValue[2], 4);
				value = Buffer.alloc(12, 3);
				value.set(DIRECT_WRITE_PLACEHOLDER);
				value[4] = 2;
				value.set([1, 2, 3, 4], 8);

				await dbBinary.put(1, value, {
					instructedWrite: true,
				});
				returnedValue = dbBinary.get(1);
				const expected = Buffer.alloc(100, 4);
				expected.set([1, 2, 3, 4], 2);
				returnedValue.should.deep.equal(expected);

				// this should always trigger the full put operation
				value = Buffer.alloc(18, 3);
				value.set(DIRECT_WRITE_PLACEHOLDER);
				value[4] = 2;
				value.set([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 8);

				await dbBinary.put(1, value, {
					instructedWrite: true,
				});
				returnedValue = dbBinary.get(1);
				expected.set([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 2);
				returnedValue.should.deep.equal(expected);
			});

			it.skip('large direct write tearing', async function () {
				// this test is for checking whether direct reads and writes cause memory "tearing"
				let dbBinary = db.openDB(
					Object.assign({
						name: 'mydb-direct-big',
						encoding: 'binary',
						compression: false,
					}),
				);
				let value = Buffer.alloc(0x5000, 4);
				await dbBinary.put(1, value);
				let f64 = new Float64Array(1);
				let u8 = new Uint8Array(f64.buffer, 0, 8);
				for (let i = 0; i < 10000; i++) {
					// this should usually accomplish in-place write
					let returnedValue = dbBinary.get(1);
					let updated_byte = i % 200;
					value = Buffer.alloc(32, updated_byte);
					value.set(DIRECT_WRITE_PLACEHOLDER);
					value[4] = 2;
					let promise = dbBinary.put(1, value, {
						instructedWrite: true,
					});
					await new Promise((resolve) => setImmediate(resolve));
					returnedValue = dbBinary.get(1);
					let dataView = new DataView(
						returnedValue.buffer,
						returnedValue.byteOffset,
						returnedValue.byteLength,
					);
					//let livef64 = new Float64Array(returnedValue.buffer, returnedValue.byteOffset,
					// returnedValue.byteLength/8);
					let j = 0;
					let k = 0;
					detect_change: do {
						j++;
						while (true) {
							let a = dataView.getFloat64(6);
							let b = dataView.getFloat64(6);
							if (a === b) {
								f64[0] = a;
								break;
							}
						}

						for (k = 0; k < 8; k++) {
							if (u8[k] === updated_byte) break detect_change;
						}
					} while (j < 1000);
					if (u8[0] !== u8[7]) console.log(j, k, u8);
				}
			});

			it.skip('small direct write tearing', async function () {
				// this test is for checking whether direct reads and writes cause memory "tearing"
				let dbBinary = db.openDB(
					Object.assign({
						name: 'mydb-direct-small',
						encoding: 'binary',
						compression: false,
					}),
				);
				let f64 = new Float64Array(1);
				let u8 = new Uint8Array(f64.buffer, 0, 8);
				for (let i = 0; i < 100000; i++) {
					/*for (let j = 0; j < 100;j++) {
						dbBinary.put(Math.random(), Buffer.alloc(Math.random() * 10)); // keep the offset random
					}*/
					let value = Buffer.alloc(16, 4);
					await dbBinary.put(1, value);

					// this should usually accomplish in-place write
					let returnedValue = dbBinary.get(1);
					let updated_byte = i % 200;
					value = Buffer.alloc(16, updated_byte);
					value.set(DIRECT_WRITE_PLACEHOLDER);
					value[4] = 2;
					let promise = dbBinary.put(1, value, {
						instructedWrite: true,
					});
					await new Promise((resolve) => setImmediate(resolve));
					let j = 0;
					let k = 0;
					returnedValue = dbBinary.getBinaryFast(1);
					let dataView = new DataView(
						returnedValue.buffer,
						returnedValue.byteOffset,
						returnedValue.byteLength,
					);
					detect_change: do {
						returnedValue = dbBinary.getBinaryFast(1);
						//let livef64 = new Float64Array(returnedValue.buffer, returnedValue.byteOffset,
						// returnedValue.byteLength/8);
						j++;
						for (k = 2; k < 10; k++) {
							if (returnedValue[k] === updated_byte) break detect_change;
						}
					} while (j < 1000);
					if (returnedValue[2] !== returnedValue[9])
						console.log(j, k, returnedValue);
				}
			});

			it('open and close', async function () {
				if (options.encryptionKey)
					// it won't match the environment
					return;
				let data = '';
				for (let i = 0; i < 1000; i++) {
					data += Math.random();
				}
				for (let i = 0; i < 10; i++) {
					options.batchStartThreshold = 5;
					options.safeRestore = i % 2 == 0;
					let db = open(testDirPath + '/təst-close.mdb', options);
					let dbMirror = openFromCJS
						? openFromCJS(testDirPath + '/təst-close.mdb', options)
						: db;
					for (let j = 0; j < 10; j++) db.put('key', data);
					let db2 = db.openDB({
						name: 'child',
					});
					db2.get('test');
					if (i > 0) {
						let v = db.get('key');
						v.should.equal(dbMirror.get('key'));
						v = db.get('key1');
						v = db.get('key2');
						v = db.get('key3');
						db.put('key', data);
						if (i == 4) await db.put('key', data);
					}
					let promise = db.close();
					expect(() => db.put('key1', data)).to.throw();
					await promise;
					if (db !== dbMirror) await dbMirror.close();
				}
			});
			it('use random access structures', async function () {
				let dbRAS = db.openDB(
					Object.assign({
						name: 'random-access',
						randomAccessStructure: true,
						sharedStructuresKey: Symbol('shared-structure'),
					}),
				);
				await dbRAS.put(1, {
					id: 1,
					name: 'one',
				});
				await dbRAS.put(2, {
					id: 2,
					name: 'two',
				});
				should.equal(dbRAS.get(1, { lazy: true }).name, 'one');
				await dbRAS.close();
				// re-open
				dbRAS = db.openDB(
					Object.assign({
						name: 'random-access',
						randomAccessStructure: true,
						sharedStructuresKey: Symbol('shared-structure'),
					}),
				);
				should.equal(dbRAS.get(2, { lazy: true }).name, 'two');
				await dbRAS.put(3, {
					id: 3,
					name: 'three',
					isOdd: true,
				});
				should.equal(dbRAS.get(3).name, 'three');
			});
			it('can backup and use backup', async function () {
				if (options.encryptionKey)
					// it won't match the environment
					return;
				let value = 'hello world';
				for (let i = 0; i < 11; i++) value += value;
				for (let i = 0; i < 180; i++) {
					let promise = db.put(
						'for-backup-' + (i % 120),
						value.slice(0, i * 50),
					);
					if (i % 10 == 9) await promise;
				}
				try {
					unlinkSync(testDirPath + '/backup.mdb');
				} catch (error) {}
				await db.flushed;
				await db.backup(testDirPath + '/backup.mdb', true);
				let backupDb = open(testDirPath + '/backup.mdb', options);
				try {
					backupDb.get('for-backup-110').should.equal(value.slice(0, 5500));
					for (let i = 0; i < 100; i++) {
						await backupDb.put('for-backup-' + i, 'test');
					}
					backupDb.get('for-backup-1').should.equal('test');
				} finally {
					await backupDb.close();
				}
			});
			after(function (done) {
				db.get('key1');
				let iterator = db.getRange({})[Symbol.iterator]();
				setTimeout(async () => {
					db.get('key1');
					db.put('another', 'something');
					// should have open read, write, and cursor transactions
					await db2.close();
					await db.close();
					if (options.encryptionKey) {
						return done();
					}
					//unlinkSync(testDirPath + '/test-' + testIteration + '.mdb');
					done();
				}, 10);
			});
		};
	}
	describe('direct key', function () {
		it('should serialize and deserialize keys', function () {
			let keys = [
				Symbol.for('test'),
				false,
				true,
				-33,
				-1.1,
				3.3,
				5,
				[5, 4],
				[5, 55],
				'hello',
				['hello', 3],
				['hello', 'world'],
				['uid', 'I-7l9ySkD-wAOULIjOEnb', 'Rwsu6gqOw8cqdCZG5_YNF'],
				'x'.repeat(1978),
				'z',
			];
			let serializedKeys = [];
			for (let key of keys) {
				let buffer = keyValueToBuffer(key);
				serializedKeys.push(bufferToKeyValue(buffer));
			}
			serializedKeys.should.deep.equal(keys);
		});
	});
	describe('uint32 keys', function () {
		this.timeout(10000);
		let db, db2;
		before(function () {
			let options = {
				keyEncoding: 'uint32',
				compression: true,
			};
			let Store = openAsClass(testDirPath, options);
			db = new Store('uint32', options);
		});
		it('write and read range', async function () {
			let lastPromise;
			for (let i = 0; i < 10; i++) {
				lastPromise = db.put(i, 'value' + i);
			}
			await lastPromise;
			let i = 0;
			for (let { key, value } of db.getRange()) {
				key.should.equal(i);
				value.should.equal('value' + i);
				i++;
			}
			i = 0;
			for (let { key, value } of db.getRange({ start: 0 })) {
				key.should.equal(i);
				value.should.equal('value' + i);
				i++;
			}
		});
		after(function () {
			db.close();
		});
	});
	describe('RangeIterable', function () {
		it('map iterate', async function () {
			let a = new RangeIterable([1, 2, 3]).map((v) => v * 2);
			let finished = 0;
			a.onDone = () => {
				finished++;
			};
			let all = [];
			for (let v of a) {
				all.push(v);
			}
			all.should.deep.equal([2, 4, 6]);
			expect(finished).to.be.equal(1);
			all = [];
			finished = 0;
			let flatMapped = a.flatMap((v) => [v, v + 1]);
			for (let v of flatMapped) {
				all.push(v);
			}
			all.should.deep.equal([2, 3, 4, 5, 6, 7]);
			expect(finished).to.be.equal(1);
			let flatMappedWithCaughtError = a
				.flatMap((v) => {
					if (v === 4) throw new Error('test');
					return [v, v + 1];
				})
				.mapError((error) => {
					return { error: error.toString() };
				});
			all = [];
			finished = 0;
			for (let v of flatMappedWithCaughtError) {
				all.push(v);
			}
			all.should.deep.equal([2, 3, { error: 'Error: test' }, 6, 7]);
			expect(finished).to.be.equal(1);
		});
		it('concat and iterate', async function () {
			let a = new RangeIterable([1, 2, 3]);
			let b = new RangeIterable([4, 5, 6]);
			let all = [];
			for (let v of a.concat(b)) {
				all.push(v);
			}
			all.should.deep.equal([1, 2, 3, 4, 5, 6]);
			let aMapped = a.map((v) => v * 2);
			all = [];
			for (let v of aMapped.concat(b)) {
				all.push(v);
			}
			all.should.deep.equal([2, 4, 6, 4, 5, 6]);
			let aMappedWithError = a.map((v) => {
				if (v === 2) throw new Error('test');
				return v * 2;
			});
			let finished = 0;
			aMappedWithError.onDone = () => {
				finished++;
			};
			expect(() => {
				for (let v of aMappedWithError.concat(b)) {
					all.push(v);
				}
			}).to.throw();
			expect(finished).to.be.equal(1);
			let aMappedWithCaught = aMappedWithError.mapError((error) => {
				return { error: error.toString() };
			});
			all = [];
			finished = 0;
			for (let v of aMappedWithCaught.concat(b)) {
				all.push(v);
				if (v.error) expect(finished).to.be.equal(0); // should not be finished until after the error
			}
			all.should.deep.equal([2, { error: 'Error: test' }, 6, 4, 5, 6]);
			expect(finished).to.be.equal(1);
		});
		it('take', function () {
			const ri = new RangeIterable([1, 2, 3, 4]);
			ri.take(2).asArray.should.deep.equal([1, 2]);
		});
		it('drop', function () {
			const ri = new RangeIterable([1, 2, 3, 4]);
			ri.drop(2).asArray.should.deep.equal([3, 4]);
		});
		it('reduce', function () {
			const ri = new RangeIterable([1, 2, 3, 4]);
			ri.reduce((sum, value) => sum + value, 0).should.equal(10);
		});
		it('some', function () {
			const ri = new RangeIterable([1, 2, 3, 4]);
			ri.some((value) => value > 2).should.equal(true);
			ri.some((value) => value > 4).should.equal(false);
		});
		it('every', function () {
			const ri = new RangeIterable([1, 2, 3, 4]);
			ri.every((value) => value > 2).should.equal(false);
			ri.every((value) => value > 0).should.equal(true);
		});
		it('find', function () {
			const ri = new RangeIterable([1, 2, 3, 4]);
			ri.find((value) => value > 2).should.equal(3);
			should.equal(ri.find((value) => value > 4), undefined);
		})
	});
	describe('mixed keys', function () {
		this.timeout(10000);
		let intKeys, strKeys;
		before(function () {
			const rootDb = open({
				name: `root`,
				path: testDirPath + '/test-mixedkeys.mdb',
				keyEncoding: 'ordered-binary',
			});

			intKeys = rootDb.openDB({
				name: `intKeys`,
				keyEncoding: 'uint32',
			});

			strKeys = rootDb.openDB({
				name: `strKeys`,
				keyEncoding: 'ordered-binary',
			});
		});
		it('create with keys', async function () {
			let lastPromise;
			for (let intKey = 0; intKey < 100; intKey++) {
				const strKey = `k${intKey}`;
				intKeys.put(intKey, `${intKey}-value`);
				lastPromise = strKeys.put(strKey, `${strKey}-value`);
			}
			await lastPromise;
		});
	});
	if (version.patch >= 90) {
		describe('Threads', function () {
			this.timeout(1000000);
			it('will run a group of threads with write transactions', function (done) {
				var child = spawn('node', [
					fileURLToPath(new URL('./threads.cjs', import.meta.url)),
				]);
				child.stdout.on('data', function (data) {
					console.log(data.toString());
				});
				child.stderr.on('data', function (data) {
					console.error(data.toString());
				});
				child.on('close', function (code) {
					code.should.equal(0);
					done();
				});
			});
		});
		describe('Read-only Threads', function () {
			this.timeout(1000000);
			it('will run a group of threads with read-only transactions', function (done) {
				var child = spawn('node', [
					fileURLToPath(new URL('./readonly-threads.cjs', import.meta.url)),
				]);
				child.stdout.on('data', function (data) {
					console.log(data.toString());
				});
				child.stderr.on('data', function (data) {
					console.error(data.toString());
				});
				child.on('close', function (code) {
					code.should.equal(0);
					done();
				});
			});
		});
	}
});

function delay(ms) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}