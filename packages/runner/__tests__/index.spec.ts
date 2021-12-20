import Runner, {AbortSignal} from '../src/index';

interface KoaContext {
    url: string;
    params: any;
    body: string;
    status: number;

    handledParams: any;
}

function handleParams(ctx: KoaContext): any {
    return {}
}

function queryMysql(param: any, {signal}: {signal?: AbortSignal}, time: number): any {
    return new Promise((resolve, reject) => {
        setTimeout(() => {
            resolve('mysql data');
        }, time);
    });
}

function queryElasticSearch(param: any, {signal}: {signal?: AbortSignal}, time: number, queryElasticSearchAbortFn: any): any {
    return new Promise((resolve, reject) => {
        let id = setTimeout(() => {
            resolve('ElasticSearch data');
        }, time);

        (signal as AbortSignal).once('abort', queryElasticSearchAbortFn || (() => {
            console.log('Abort to query ElasticSearch ');
            id && clearTimeout(id);
        }));
    });
}

function computeData(data: any, ctx: KoaContext, time: number): any {
    return new Promise((resolve, reject) => {
        setTimeout(() => {
            resolve('computeData result');
        }, time);
    });
}

async function formatData(data: any, ctx: KoaContext) {
    return 'formatData result';
}



async function complexRun(option: any, extra: any) {
    const options = Object.assign({
        timeout: 3000, // 总体runner的超时时间
        everyTimeout: 2800, // 每个任务的超时时间
        failStrategy: 'anyOne', // anyOne：只要一个task失败，runner就失败；everyOne：每个task都是失败，runner才失败
        autoNext: true,  // 自动执行下一个task
        context: {}, // 每个task run函数的第一个参数，用户定义
    }, option);

    // 1. 初始化
    const runner = new Runner(options);

    // 2. 增加异步任务
    runner.add((ctx: KoaContext, previousResult: any, {signal}) => {
        // 处理参数
        ctx.handledParams = handleParams(ctx);

    }).add([
        (ctx: KoaContext, [previousResult], {signal}) => {
            return queryMysql(ctx.handledParams, {signal}, extra.queryMysqlTime || 1);
        },
        (ctx: KoaContext, [previousResult], {signal}) => {
            return extra.queryElasticSearchFn ? extra.queryElasticSearchFn(
                    ctx.handledParams,
                    {signal})
                : queryElasticSearch(
                    ctx.handledParams,
                    {signal},
                    extra.queryElasticSearchTime || 1,
                    extra.queryElasticSearchAbortFn
            );
        }
    ]).add((ctx: KoaContext, [previousResult]) => {
        return computeData(previousResult, ctx, extra.computeDataTime || 1);

    }).add(async (ctx: KoaContext, [previousResult]) => {
        ctx.body = await formatData(previousResult, ctx);
    });

    let error: any;
    // 3. 运行
    try {
        await runner.run();
    }
    catch (e: any) {
        error = e.message;
    }

    // console.log('stats', runner.getStats())

    return {
        error,
        stats: runner.getStats(),
        runner,
    };
}

describe('basic run cases', () => {

    it('no task to run', async () => {
        const options = Object.assign({
            timeout: 3000, // 总体runner的超时时间
            everyTimeout: 2800, // 每个任务的超时时间
            failStrategy: 'anyOne', // anyOne：只要一个task失败，runner就失败；everyOne：每个task都是失败，runner才失败
            autoNext: false,  // 自动执行下一个task
            context: {a: 2}, // 每个task run函数的第一个参数，用户定义
        }, );

        const runner = new Runner(options);

        expect(runner.state).toBe('init');
        runner.run();
        expect(runner.state).toBe('end');
    })

    it('option autoNext and context', async () => {
        const context = {a: 2};
        const options = Object.assign({
            timeout: 3000, // 总体runner的超时时间
            everyTimeout: 2800, // 每个任务的超时时间
            failStrategy: 'anyOne', // anyOne：只要一个task失败，runner就失败；everyOne：每个task都是失败，runner才失败
            autoNext: false,  // 自动执行下一个task
            context: context, // 每个task run函数的第一个参数，用户定义
        }, );

        const runner = new Runner(options);

        expect(runner.state).toBe('init');

        const taskRun = jest.fn((ctx: any, previousResult: any, {signal}) => {

        });
        runner.add(taskRun);
        runner.add(taskRun);

        runner.run();

        // The first argument of the first call to the function was 0
        expect(taskRun.mock.calls[0][0]).toBeDefined();
        expect(taskRun.mock.calls[0][0]).toBe(context);


        expect(runner.runningIndex).toBe(0);
        expect(runner.state).toBe('running');
    })

    it('option failStrategy = anyOne', async () => {
        let runner = new Runner({
            failStrategy: 'anyOne', // anyOne：只要一个task失败，runner就失败；everyOne：每个task都是失败，runner才失败
        });

        expect(runner.state).toBe('init');

        const taskRun1 = jest.fn((ctx: any, previousResult: any, {signal}) => {
            throw new Error('some wrong');
        });
        const taskRun2 = jest.fn((ctx: any, previousResult: any, {signal}) => {

        });
        runner.add(taskRun1);
        runner.add(taskRun2);

        try {
            await runner.run();
        }
        catch (e: any) {

        }

        expect(taskRun1.mock.calls.length).toBe(1);
        expect(taskRun2.mock.calls.length).toBe(0);
        expect(runner.state).toBe('fail');

        // 解下来，改变参数
        runner = new Runner({
            failStrategy: 'everyOne', // anyOne：只要一个task失败，runner就失败；everyOne：每个task都是失败，runner才失败
        });
        runner.add(taskRun1);
        runner.add(taskRun2);
        try {
            await runner.run();
        }
        catch (e: any) {}
        let stats = runner.getStats();

        expect(taskRun1.mock.calls.length).toBe(2);
        expect(taskRun2.mock.calls.length).toBe(1);
        expect(stats[0][0].state).toBe('fail');
        expect(stats[1][0].state).toBe('end');
        expect(runner.state).toBe('end');

        // 解下来，改变参数，2个task都失败
        runner = new Runner({
            failStrategy: 'everyOne', // anyOne：只要一个task失败，runner就失败；everyOne：每个task都是失败，runner才失败
        });

        const taskRun3 = jest.fn((ctx: any, previousResult: any, {signal}) => {
            throw new Error('some wrong 3');
        });
        runner.add(taskRun1);
        runner.add(taskRun3);
        try {
            await runner.run();
        }
        catch (e: any) {
            expect(e.message).toBe('Every task is failed');
        }
        stats = runner.getStats();

        expect(taskRun1.mock.calls.length).toBe(3);
        expect(taskRun3.mock.calls.length).toBe(1);
        expect(stats[0][0].state).toBe('fail');
        expect(stats[1][0].state).toBe('fail');
        expect(runner.state).toBe('fail');
    })
});

describe('complex run cases', () => {

    it('run four combo and a combo with two parallel tasks', async () => {
        const queryElasticSearchAbortFn = jest.fn(() => {});

        let {error, stats, runner} = await complexRun({
            timeout: 1000, // 总体runner的超时时间
            everyTimeout: 1000, // 每个任务的超时时间
        }, {
            queryMysqlTime: 1, // 设置mock时间
            queryElasticSearchTime: 1,
            queryElasticSearchAbortFn: queryElasticSearchAbortFn
        });

        expect(error).toBeUndefined();
        expect(stats.length).toBe(4);
        expect(stats[1].length).toBe(2);

        // queryMysql task
        expect(stats[1][0].cost).toBeLessThan(100);
        expect(stats[1][0].state).toBe('end');

        // queryElasticSearch task
        expect(stats[1][1].cost).toBeLessThan(100);
        expect(stats[1][1].state).toBe('end');
        expect(stats[1][1].errorMessage).toBeUndefined();

        expect(runner.state).toBe('end');

        expect(queryElasticSearchAbortFn.mock.calls.length).toBe(0);
    });

    it('in paralle tasks, one task timeout, another task is aborted', async () => {
        const queryElasticSearchAbortFn = jest.fn(() => {});

        let {error, stats, runner} = await complexRun({
            timeout: 1000, // 总体runner的超时时间
            everyTimeout: 5000, // 每个任务的超时时间
        }, {
            queryMysqlTime: 1001, // 设置mock时间
            queryElasticSearchTime: 2000,
            queryElasticSearchAbortFn: queryElasticSearchAbortFn
        });


        expect(error).toBe('Runner Timeout: 1000ms');
        expect(stats.length).toBe(4);
        expect(stats[1].length).toBe(2);

        // queryMysql task
        expect(stats[1][0].cost).toBeGreaterThanOrEqual(1001);
        expect(stats[1][0].state).toBe('end');

        // queryElasticSearch task
        expect(stats[1][1].cost).toBeGreaterThanOrEqual(1001);
        expect(stats[1][1].cost).toBeLessThan(1500); // 其应该被abort，在1000多点，所以不应该达到设置2000
        expect(stats[1][1].state).toBe('fail');
        expect(stats[1][1].errorMessage).toBe('Task 2_2: Aborted');

        expect(runner.state).toBe('fail');

        expect(queryElasticSearchAbortFn.mock.calls.length).toBe(1);
    });

    it('in paralle tasks, one task timeout in advance, another task error', async () => {

        // 不可取消的
        const queryElasticSearchFn = jest.fn((param: any, {signal}: {signal?: AbortSignal}) => {
            return new Promise((resolve, reject) => {
                setTimeout(() => {
                    reject('Failed to ElasticSearch data');
                }, 1500);
            });
        });

        let {error, stats, runner} = await complexRun({
            timeout: 1000, // 总体runner的超时时间
            everyTimeout: 2000, // 每个任务的超时时间
        }, {
            queryMysqlTime: 1001, // 设置mock时间
            queryElasticSearchFn,
        });

        expect(error).toBe('Runner Timeout: 1000ms');
        expect(stats.length).toBe(4);
        expect(stats[1].length).toBe(2);

        // queryMysql task
        expect(stats[1][0].cost).toBeGreaterThanOrEqual(1001);
        expect(stats[1][0].state).toBe('end');

        // queryElasticSearch task
        expect(stats[1][1].cost).toBeGreaterThanOrEqual(1001);
        expect(stats[1][1].cost).toBeLessThan(1500); // 其应该被abort，在1000多点，所以不应该达到设置2000
        expect(stats[1][1].state).toBe('fail');
        expect(stats[1][1].errorMessage).toBe('Task 2_2: Aborted');

        expect(runner.state).toBe('fail');

        expect(queryElasticSearchFn.mock.calls.length).toBe(1);
    });


    it('in paralle tasks, one task timeout, another task error in advance', async () => {

        // 不可取消的
        const queryElasticSearchFn = jest.fn((param: any, {signal}: {signal?: AbortSignal}) => {
            return new Promise((resolve, reject) => {
                setTimeout(() => {
                    // reject('Failed to ElasticSearch data');
                }, 1500);
                reject('Failed to get ElasticSearch data');
            });
        });

        let {error, stats, runner} = await complexRun({
            timeout: 1000, // 总体runner的超时时间
            everyTimeout: 2000, // 每个任务的超时时间
        }, {
            queryMysqlTime: 1001, // 设置mock时间
            queryElasticSearchFn,
        });

        expect(error).toBe('Task 2_2: Failed to get ElasticSearch data');
        expect(stats.length).toBe(4);
        expect(stats[1].length).toBe(2);

        // queryMysql task
        expect(stats[1][0].cost).toBeGreaterThanOrEqual(0);
        expect(stats[1][0].state).toBe('fail');

        // queryElasticSearch task
        expect(stats[1][1].cost).toBeGreaterThanOrEqual(0);
        expect(stats[1][1].cost).toBeLessThan(1500); // 其应该被abort，在1000多点，所以不应该达到设置2000
        expect(stats[1][1].state).toBe('fail');
        expect(stats[1][1].errorMessage).toBe('Task 2_2: Failed to get ElasticSearch data');

        expect(runner.state).toBe('fail');

        expect(queryElasticSearchFn.mock.calls.length).toBe(1);
    });
});
