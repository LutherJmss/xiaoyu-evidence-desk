import 'dotenv/config';
import { Clocked } from 'clocked-sdk';

const clocked = new Clocked({
  timeout: 15000,
  maxAttempts: 1,
});

try {
  console.log('正在连接 Clocked API，最多等待15秒...');

  const result = await clocked.extract(
    {
      text: '报名截止日期为2026年11月10日23:59。参赛者必须年满18岁。',
      fields: {
        deadline: '报名截止日期和时间',
        age_requirement: '最低年龄要求',
      },
    },
    {
      idempotencyKey: '00000000-0000-4000-8000-000000000001',
      timeout: 120000,
      maxAttempts: 1,
    }
  );

  console.log('\n✅ 收到 API 响应：');
  console.log(JSON.stringify(result, null, 2));

} catch (error) {
  console.log('\n❌ 请求失败');
  console.log('错误类型：', error.name);
  console.log('错误信息：', error.message);
  console.log('状态码：', error.status ?? '未知');
  console.log('底层错误代码：', error.cause?.code ?? '无');
  console.log('底层错误详情：', error.cause?.message ?? '无');
  if (error.body) {
    console.log('错误详情：', JSON.stringify(error.body, null, 2));
  }
}
