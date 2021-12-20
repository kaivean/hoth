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

function queryMysql(param: any, {signal}: {signal?: AbortSignal}): any {
    return new Promise((resolve, reject) => {
        let id = setTimeout(() => {
            console.log('task', 'queryMysql');
            resolve('mysql data');
        }, 3000);

        (signal as AbortSignal).once('abort', () => {
            console.log('Abort to query Mysql ');
            id && clearTimeout(id);
        });
    });
}

function queryElasticSearch(param: any, {signal}: {signal?: AbortSignal}): any {
    return new Promise((resolve, reject) => {
        let id = setTimeout(() => {
            console.log('task', 'queryElasticSearch');
            resolve('ElasticSearch data');
        }, 4000);

        (signal as AbortSignal).once('abort', () => {
            console.log('Abort to query ElasticSearch ');
            id && clearTimeout(id);
        });
    });
}

function computeData(mysqlData: any, esData: any, ctx: KoaContext): any {
    return new Promise((resolve, reject) => {
        setTimeout(() => {
            resolve('computeData result');
        }, 1000);
    });
}

async function formatData(data: any, ctx: KoaContext) {
    return 'formatData result';
}



const app: any = {
    use(fn: any) {
        fn({});
    }
};

// 基于任务调度器的 新写法
app.use(async (ctx: KoaContext) => {

    // 1. 初始化
    const runner = new Runner({
        timeout: 3000, // 总体runner的超时时间
        everyTimeout: 2800, // 每个任务的超时时间
        failStrategy: 'anyOne', // anyOne：只要一个task失败，runner就失败；everyOne：每个task都是失败，runner才失败
        autoNext: true,  // 自动执行下一个task
        context: ctx, // 每个task run函数的第一个参数，用户定义
        startTime: Date.now(), // 整个runner的时间计算的起点，默认是当前时间，但也可以更改为收到请求时间
    });


    // 2. 增加异步任务
    runner.add((ctx: KoaContext, previousResult: any, {signal}) => {
        // 处理参数
        ctx.handledParams = handleParams(ctx);

    }).add([ // 是个数组，说明这是增加一个并行执行的combo task，其每个项为子task，两个子task，任何一个失败，该combo task即为失败
        (ctx: KoaContext, [previousResult], {signal}) => {
            return queryMysql(ctx.handledParams, {signal});

        },
        (ctx: KoaContext, [previousResult], {signal}) => {
            return queryElasticSearch(ctx.handledParams, {signal});

        }
    ]).add((ctx: KoaContext, [mysqlData, esData]) => {
        return computeData(mysqlData, esData, ctx);

    }).add(async (ctx: KoaContext, [previousResult]) => {
        ctx.body = await formatData(previousResult, ctx);
    });

    // 3. 运行
    try {
        await runner.run();
    }
    catch (e) {
        ctx.status = 500;
        console.error('Fail: ', e);
    }
});


// 原始的写法
app.use(async (ctx: KoaContext) => {

    // 处理参数
    const handledParams = handleParams(ctx);

    // 查询数据
    const mysqlData = await queryMysql(handledParams, {});

    // 查询数据
    const esData = await queryElasticSearch(handledParams, {});

    // 复杂计算
    const data = await computeData(mysqlData, esData, ctx);

    // 格式化数据并返回
    ctx.body = await formatData(data, ctx);
});