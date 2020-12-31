import Sequelize from 'sequelize'
import defaults from 'lodash/defaults'

export const sequelize = createSequelize()

export function createSequelize(options = {}) {
  const env = process.env
  const dialect = env.DIALECT || 'sqlite'
  const config = defaults(
    {},
    dialect === 'postgres' && {
      host: env.POSTGRES_PORT_5432_TCP_ADDR,
      user: env.POSTGRES_ENV_POSTGRES_USER,
      password: env.POSTGRES_ENV_POSTGRES_PASSWORD,
      database: env.POSTGRES_ENV_POSTGRES_DATABASE,
    },
    dialect === 'mysql' && {
      port: 3306,
      host: env.MYSQL_PORT_3306_TCP_ADDR,
      user: env.MYSQL_ENV_MYSQL_USER,
      password: env.MYSQL_ENV_MYSQL_PASSWORD,
      database: env.MYSQL_ENV_MYSQL_DATABASE,
    },
    dialect === 'postgres' &&
      env.CI && {
        user: 'postgres',
        password: 'gql_sequelize',
        database: 'circle_test',
      },
    dialect === 'mysql' &&
      env.CI && {
        user: 'root',
        password: 'gql_sequelize',
        database: 'circle_test',
      },
    {
      host: 'localhost',
      user: 'gql_sequelize',
      password: 'gql_sequelize',
      database: 'gql_sequelize',
    }
  )

  return new Sequelize(config.database, config.user, config.password, {
    host: config.host,
    dialect,
    logging: false,
    ...options,
  })
}

export function beforeRemoveAllTables() {
  before(async function () {
    if (sequelize.dialect.name === 'mysql') {
      this.timeout(20000)
      await removeAllTables(sequelize)
    }
  })
}

// Not nice too, MySQL does not supports same name for foreign keys
// Solution ? Force remove all tables!
export async function removeAllTables(sequelize) {
  async function getTables() {
    return (await sequelize.query('show tables;'))[0].map(
      (table) => table[`Tables_in_${sequelize.getDatabaseName()}`]
    )
  }
  const tables = await getTables()
  await Promise.all(
    tables.map(
      async (table) =>
        await sequelize.query('drop table ' + table).catch(() => {})
    )
  )
  const tablesNow = await getTables()
  if (tablesNow.length) {
    await removeAllTables(sequelize)
  }
}
