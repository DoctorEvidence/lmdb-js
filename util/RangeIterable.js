export const SKIP = {};
const DONE = {
	value: null,
	done: true,
}
if (!Symbol.asyncIterator) {
	Symbol.asyncIterator = Symbol.for('Symbol.asyncIterator');
}

export class RangeIterable {
	constructor(sourceArray) {
		if (sourceArray) {
			this.iterate = sourceArray[Symbol.iterator].bind(sourceArray);
		}
	}
	map(func) {
		let source = this;
		let iterable = new RangeIterable();
		iterable.iterate = (async) => {
			let iterator = source[async ? Symbol.asyncIterator : Symbol.iterator]();
			let i = 0;
			return {
				next(resolvedResult) {
					try {
					let result;
						do {
							let iteratorResult;
							if (resolvedResult) {
								iteratorResult = resolvedResult;
								resolvedResult = null; // don't go in this branch on next iteration
							} else {
								iteratorResult = iterator.next();
								if (iteratorResult.then) {
									if (!async) {
										throw new Error('Can not synchronously iterate with asynchronous values');
									}
									return iteratorResult.then(iteratorResult => this.next(iteratorResult), onError);
								}
							}
							if (iteratorResult.done === true) {
								this.done = true;
								if (iterable.onDone) iterable.onDone();
								return iteratorResult;
							}
							result = func(iteratorResult.value, i++);
							if (result && result.then) {
								if (!async) {
									throw new Error('Can not synchronously iterate with asynchronous values');
								}
								return result.then(result =>
									result === SKIP ?
										this.next() :
										{
											value: result
										}, onError);
							}
						} while(result === SKIP);
						if (result === DONE) {
							if (iterable.onDone) iterable.onDone();
							return result;
						}
						return {
							value: result
						};
					} catch(error) {
						onError(error);
					}
				},
				return() {
					if (iterable.onDone) iterable.onDone();
					return iterator.return();
				},
				throw() {
					if (iterable.onDone) iterable.onDone();
					return iterator.throw();
				}
			};
		};
		function onError(error) {
			if (iterable.onDone) iterable.onDone();
			throw error;
		}
		return iterable;
	}
	[Symbol.asyncIterator]() {
		return this.iterator = this.iterate(true);
	}
	[Symbol.iterator]() {
		return this.iterator = this.iterate();
	}
	filter(func) {
		return this.map(element => {
			let result = func(element);
			// handle promise
			if (result?.then) return result.then((result) => result ? element : SKIP);
			else return result ? element : SKIP;
		});
	}

	forEach(callback) {
		let iterator = this.iterator = this.iterate();
		let result;
		while ((result = iterator.next()).done !== true) {
			callback(result.value);
		}
	}
	concat(secondIterable) {
		let concatIterable = new RangeIterable();
		concatIterable.iterate = (async) => {
			let iterator = this.iterator = this.iterate(async);
			let isFirst = true;
			function iteratorDone(result) {
				if (isFirst) {
					try {
						isFirst = false;
						iterator = secondIterable[async ? Symbol.asyncIterator : Symbol.iterator]();
						result = iterator.next();
						if (concatIterable.onDone) {
							if (result.then) {
								if (!async) throw new Error('Can not synchronously iterate with asynchronous values');
								result.then((result) => {
									if (result.done()) concatIterable.onDone();
								}, onError);
							} else if (result.done) concatIterable.onDone();
						}
					} catch (error) {
						onError(error);
					}
				} else {
					if (concatIterable.onDone) concatIterable.onDone();
				}
				return result;
			}
			return {
				next() {
					try {
						let result = iterator.next();
						if (result.then) {
							if (!async) throw new Error('Can synchronously iterate with asynchronous values');
							return result.then((result) => {
								if (result.done) return iteratorDone(result);
								return result;
							});
						}
						if (result.done) return iteratorDone(result);
						return result;
					} catch (error) {
						onError(error);
					}
				},
				return() {
					if (concatIterable.onDone) concatIterable.onDone();
					return iterator.return();
				},
				throw() {
					if (concatIterable.onDone) concatIterable.onDone();
					return iterator.throw();
				}
			};
		};
		function onError(error) {
			if (iterable.onDone) iterable.onDone();
			throw error;
		}

		return concatIterable;
	}

	flatMap(callback) {
		let mappedIterable = new RangeIterable();
		mappedIterable.iterate = (async) => {
			let iterator = this.iterator = this.iterate(async);
			let isFirst = true;
			let currentSubIterator;
			return {
				next(resolvedResult) {
					try {
						do {
							if (currentSubIterator) {
								let result;
								if (resolvedResult) {
									result = resolvedResult;
									resolvedResult = undefined;
								} else result = currentSubIterator.next();
								if (result.then) {
									if (!async) throw new Error('Can not synchronously iterate with asynchronous values');
									return result.then((result) => this.next(result));
								}
								if (!result.done) {
									return result;
								}
							}
							let result = resolvedResult ?? iterator.next();
							if (result.then) {
								if (!async) throw new Error('Can not synchronously iterate with asynchronous values');
								currentSubIterator = undefined;
								return result.then((result) => this.next(result));
							}
							if (result.done) {
								if (mappedIterable.onDone) mappedIterable.onDone();
								return result;
							}
							let value = callback(result.value);
							if (value?.then) {
								if (!async) throw new Error('Can not synchronously iterate with asynchronous values');
								return value.then((value) => {
									if (Array.isArray(value) || value instanceof RangeIterable) {
										currentSubIterator = value[Symbol.iterator]();
										return this.next();
									} else {
										currentSubIterator = null;
										return { value };
									}
								})
							}
							if (Array.isArray(value) || value instanceof RangeIterable)
								currentSubIterator = value[Symbol.iterator]();
							else {
								currentSubIterator = null;
								return { value };
							}
						} while(true);
					} catch (error) {
						onError(error);
					}
				},
				return() {
					if (mappedIterable.onDone) mappedIterable.onDone();
					if (currentSubIterator)
						currentSubIterator.return();
					return iterator.return();
				},
				throw() {
					if (mappedIterable.onDone) mappedIterable.onDone();
					if (currentSubIterator)
						currentSubIterator.throw();
					return iterator.throw();
				}
			};
		};
		function onError(error) {
			if (iterable.onDone) iterable.onDone();
			throw error;
		}
		return mappedIterable;
	}

	slice(start, end) {
		return this.map((element, i) => {
			if (i < start)
				return SKIP;
			if (i >= end) {
				DONE.value = element;
				return DONE;
			}
			return element;
		});
	}
	next() {
		if (!this.iterator)
			this.iterator = this.iterate();
		return this.iterator.next();
	}
	toJSON() {
		if (this.asArray && this.asArray.forEach) {
			return this.asArray;
		}
		const error = new Error('Can not serialize async iterables without first calling resolving asArray');
		error.resolution = this.asArray;
		throw error;
		//return Array.from(this)
	}
	get asArray() {
		if (this._asArray)
			return this._asArray;
		let promise = new Promise((resolve, reject) => {
			let iterator = this.iterate(true);
			let array = [];
			let iterable = this;
			Object.defineProperty(array, 'iterable', { value: iterable });
			function next(result) {
				while (result.done !== true) {
					if (result.then) {
						return result.then(next);
					} else {
						array.push(result.value);
					}
					result = iterator.next();
				}
				resolve(iterable._asArray = array);
			}
			next(iterator.next());
		});
		promise.iterable = this;
		return this._asArray || (this._asArray = promise);
	}
	resolveData() {
		return this.asArray;
	}
}
RangeIterable.prototype.DONE = DONE;