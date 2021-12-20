# @hoth/runner

提供任务拆解能力，对任务进行超时管控，支持未来标准的AbortSignal中断信号

## 使用方式

### 传统写法

在Koa等框架中间件实现路由处理

```javascript
// 原始的写法
app.use(async (ctx: KoaContext) => {
    try {
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
    }
    catch (e) {
        ctx.status = 500;
        console.error('Fail: ', e);
    }
});
```


### 新写法

在路由里，将任务提交给统一调度器管理，其具备超时中断能力

```ts
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

    }).add([
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
```

