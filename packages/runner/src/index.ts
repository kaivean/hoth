
import {EventEmitter} from 'events';

interface RunParam {
    signal: AbortSignal;
}

type RunFn = (ctx: any, previousResult: any[], param: RunParam) => (any | Promise<any>);
interface Task {
    id: string;
    everyTimeout: number;
    run: RunFn;
    state: 'init' | 'running' | 'end' | 'fail';
    cost: number;
    abortSignal: AbortSignal;
    error?: Error;
    result?: any;
    startTime?: number;
}

type TaskParams = {everyTimeout?: number, run: RunFn};
type TaskParam = RunFn | TaskParams


export class AbortSignal extends EventEmitter {
    aborted: boolean = false;
    constructor () {
        super();
    }
}

export default class Runner extends EventEmitter {
    queue: Task[][] = [];
    startTime: number;
    cost: number = 0;
    timeout: number;
    everyTimeout: number;
    parallelNumber: number;
    context: any = {};
    state: 'init' | 'running' | 'end' | 'fail' = 'init';
    runningIndex = -1;
    failStrategy: 'anyOne' | 'everyOne';
    autoNext: boolean;

    constructor (option: any = {}) {
        super();
        this.parallelNumber = option.parallelNumber || 1;
        this.timeout = option.timeout || 3000;
        this.everyTimeout = option.everyTimeout || 1000;
        this.context = option.context || {};
        this.failStrategy = option.failStrategy || 'anyOne';
        this.autoNext = option.autoNext || true;
        this.startTime = option.startTime || Date.now();
    }
    add(objs: TaskParam | TaskParam[]) {
        if (!Array.isArray(objs)) {
            objs = [objs];
        }
        let paralleTaskSet: Task[] = [];

        for (let index = 0; index < objs.length; index++) {
            const obj = objs[index];
            const id = (this.queue.length + 1) + '_' + (index + 1);
            // Todo: 参数校验
            if (typeof obj === 'function') {
                paralleTaskSet.push({
                    id,
                    everyTimeout: this.everyTimeout,
                    run: obj,
                    state: 'init',
                    cost: -1,
                    abortSignal: new AbortSignal(),
                });
            }
            else {
                paralleTaskSet.push({
                    id,
                    everyTimeout: obj.everyTimeout ||  this.everyTimeout,
                    run: obj.run,
                    state: 'init',
                    cost: -1,
                    abortSignal: new AbortSignal(),
                });
            }
        }

        this.queue.push(paralleTaskSet);

        return this;
    }

    async run() {
        this.state = 'running';

        await this.runNext();
    }

    getTasks() {
        return this.queue;
    }

    getStats() {
        const stats = [];
        for (const paralleTaskSet of this.queue) {
            const subStats = [];
            for (const task of paralleTaskSet) {
                if (task.abortSignal) {
                    task.abortSignal.removeAllListeners();
                }
                subStats.push({
                    id: task.id,
                    cost: task.cost,
                    state: task.state,
                    errorMessage: task.error && task.error.message
                });
            }
            stats.push(subStats)
        }

        return stats;
    }

    destroy() {
        for (const paralleTaskSet of this.queue) {
            for (const task of paralleTaskSet) {
                if (task.abortSignal) {
                    task.abortSignal.removeAllListeners();
                }
            }
        }
        this.removeAllListeners();
    }

    // 设置整个runner状态信息
    private setFail(e: Error) {
        this.state = 'fail';
        throw e;
    }

    // 设置整个runner状态信息
    private setEnd() {
        if (this.failStrategy === 'everyOne') {
            // 每个任务都是失败，就设置为失败
            if (this.queue.every(
                paralleTaskSet => paralleTaskSet.every(task => task.state === 'fail')
            )) {
                this.setFail(new Error('Every task is failed'));
                return;
            }
        }
        this.state = 'end';
    }

    private hasNext() {
        if (this.runningIndex < this.queue.length) {
            if (this.state === 'running') {
                return true;
            }
        }
        return false;
    }

    async runTask(task: Task, onFinish: any) {
        // console.log('run', task.id, 'runner cost', this.cost);

        task.startTime = Date.now();
        let timerId: NodeJS.Timeout | null = null;

        if (task.state !== 'init') {
            return;
        }

        task.state = 'running';

        try {
            let abortSignal = task.abortSignal;
            let previousResults: any[] = [];
            if (this.runningIndex > 0) {
                const preParalleTaskSet = this.queue[this.runningIndex - 1];
                previousResults = preParalleTaskSet.map(task => task.result);
            }
            task.result = await new Promise((resolve, reject) => {
                // 还没有执行就被中断，应该有其他并行任务失败，导致并行所有任务都被aborted
                if (abortSignal.aborted) {
                    reject(new Error('Aborted'));
                    return;
                }

                timerId = setTimeout(() => {
                    reject(new Error('Timeout ' + task.everyTimeout + 'ms'));
                }, task.everyTimeout);

                abortSignal.once('abort', () => {
                    reject(new Error('Aborted'));
                });

                const promiseOrResult = task.run(this.context, previousResults, {signal: abortSignal});
                if (
                    typeof promiseOrResult === 'object' && typeof (promiseOrResult as any).then === 'function' && typeof (promiseOrResult as any).catch === 'function'
                ) {
                    promiseOrResult.then(resolve).catch(reject)
                }
                else {
                    resolve(promiseOrResult);
                }
            });
            task.state = 'end';
        }
        catch (e: any) {
            if (!(e instanceof Error)) {
                e = new Error(String(e));
            }
            // 设置单个task状态信息
            task.error = e;
            task.state = 'fail';
            // 设置整个runner状态信息
            e.message = `Task ${task.id}: ` + e.message;

            // console.error('task', task.id, 'error', e);
        }
        if (timerId) {
            clearTimeout(timerId);
            timerId = null;
        }
        task.cost = Date.now() - task.startTime;

        onFinish(task.error);
    }

    async stopParalle(task: Task, paralleTaskSet: Task[]) {
        if (task.abortSignal.aborted) {
            return;
        }

        // 有一个任务失败，则要通知到所有正在进行的任务进行中断，所有还未运行的任务，不再运行
        for (const task of paralleTaskSet) {
            if (task.state === 'running' || task.state === 'init') {
                task.abortSignal.aborted = true;
                task.abortSignal.emit('abort');
            }
        }
    }

    async runParalle(paralleTaskSet: Task[]) {
        let pros = [];
        let error: Error | null = null;
        for (const task of paralleTaskSet) {
            pros.push(
                this.runTask(task, (e?: Error) => {
                    // 成功了
                    if (!e) {
                        this.cost = Date.now() - this.startTime;
                        // 整个Runner超时判断
                        if (this.cost > this.timeout) {
                            this.stopParalle(task, paralleTaskSet);

                            !error && (error = new Error('Runner Timeout: ' + this.timeout + 'ms'));
                        }
                    }
                    // 失败了
                    else {
                        this.stopParalle(task, paralleTaskSet);

                        // error为空，才赋值，也就是仅第一次错误给error
                        !error && (error = e);
                    }
                })
            );
        }
        await Promise.all(pros);

        if (error) {
            throw error;
        }
    }

    async runNext() {
        this.runningIndex++;

        if (!this.hasNext()) {
            this.setEnd();
            return;
        }

        const paralleTaskSet = this.queue[this.runningIndex];

        try {
            await this.runParalle(paralleTaskSet);
        }
        catch (e: any) {
            // 普通错误，根据failStrategy
            if (this.failStrategy === 'anyOne') {
                // 此时throw出去了，后续逻辑不执行了
                this.setFail(e);
            }

            // 整个runner超时错误，就不管failStrategy是否anyOne了，都中断runner
            else if (e.message.startsWith('Runner Timeout')) {
                this.setFail(e);
            }
        }

        if (this.autoNext) {
            await this.runNext();
        }
    }
}

