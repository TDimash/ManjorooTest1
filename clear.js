const mongoose = require('mongoose');
const MONGODB_URI = 'mongodb://mongo:IyJfyncoxZBZGMbkEnCJHlbPtcBPxTQR@autorack.proxy.rlwy.net:56739';

async function reset() {
  console.log('Подключение к БД для очистки...');
  await mongoose.connect(MONGODB_URI);
  console.log('Удаление старых данных...');
  await mongoose.connection.db.dropDatabase();
  console.log(' БД успешно очищена! Все старые юзеры и логи стерты.');
  process.exit(0);
}
reset().catch(err => { console.error(err); process.exit(1); });
