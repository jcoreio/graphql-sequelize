'use strict'

import { expect } from 'chai'
import Sequelize from 'sequelize'
import sinon from 'sinon'
import attributeFields from '../../../src/attributeFields'
import resolver from '../../../src/resolver'
import { uniq } from 'lodash'
import { sequelize } from '../../support/helper'

import {
  sequelizeConnection,
  createConnectionResolver,
} from '../../../src/relay'

import {
  GraphQLInt,
  GraphQLNonNull,
  GraphQLBoolean,
  GraphQLEnumType,
  GraphQLList,
  GraphQLObjectType,
  GraphQLSchema,
  graphql,
} from 'graphql'

import { globalIdField, toGlobalId, fromGlobalId } from 'graphql-relay'

import Op from '../../../src/sequelizeOps'

describe('relay', function () {
  describe('connection', function () {
    before(async function () {
      var self = this

      this.User = sequelize.define('user', {})

      this.Project = sequelize.define('project', {})

      this.Task = sequelize.define(
        'task',
        {
          name: Sequelize.STRING,
          completed: Sequelize.BOOLEAN,
          otherDate: Sequelize.DATE,
        },
        {
          timestamps: true,
        }
      )

      this.ProjectMember = sequelize.define('projectMember', {})

      this.User.Tasks = this.User.hasMany(this.Task, {
        as: 'tasks',
        foreignKey: 'userId',
      })
      this.User.Projects = this.User.belongsToMany(this.Project, {
        as: 'projects',
        through: this.ProjectMember,
      })
      this.Project.belongsToMany(this.User, { through: this.ProjectMember })

      this.Project.Tasks = this.Project.hasMany(this.Task, {
        as: 'tasks',
        foreignKey: 'projectId',
      })
      this.Task.Project = this.Task.belongsTo(this.Project, {
        as: 'project',
        foreignKey: 'projectId',
      })

      this.Project.Owner = this.Project.belongsTo(this.User, {
        as: 'owner',
        foreignKey: 'ownerId',
      })

      this.taskType = new GraphQLObjectType({
        name: this.Task.name,
        fields: {
          ...attributeFields(this.Task),
          id: globalIdField(this.Task.name),
        },
      })

      this.projectOrderSpy = sinon.spy(() => 'name')
      this.projectTaskConnectionFieldSpy = sinon.spy()
      this.projectTaskConnection = sequelizeConnection({
        name: 'projectTask',
        nodeType: this.taskType,
        target: this.Project.Tasks,
        orderBy: new GraphQLEnumType({
          name: this.Project.name + this.Task.name + 'ConnectionOrder',
          values: {
            ID: { value: [this.Task.primaryKeyAttribute, 'ASC'] },
            LATEST: { value: ['createdAt', 'DESC'] },
            NAME: { value: ['name', 'ASC'] },
            NAME_FUNC: { value: [this.projectOrderSpy, 'ASC'] },
            NAME_NULLS_LAST: { value: ['name', 'ASC NULLS LAST'] },
          },
        }),
        connectionFields: () => ({
          totalCount: {
            type: GraphQLInt,
            resolve(connection, args, { logging }) {
              self.projectTaskConnectionFieldSpy(connection)
              return connection.source.countTasks({
                where: connection.where,
                logging,
              })
            },
          },
        }),
      })

      this.projectType = new GraphQLObjectType({
        name: this.Project.name,
        fields: {
          ...attributeFields(this.Project),
          id: globalIdField(this.Project.name),
          tasks: {
            type: this.projectTaskConnection.connectionType,
            args: this.projectTaskConnection.connectionArgs,
            resolve: this.projectTaskConnection.resolve,
          },
        },
      })

      this.userTaskConnectionFieldSpy = sinon.spy()
      const queryGenerator =
        sequelize.dialect.queryGenerator || sequelize.dialect.QueryGenerator
      this.userTaskConnection = sequelizeConnection({
        name: 'userTask',
        nodeType: this.taskType,
        target: () => this.User.Tasks,
        orderBy: new GraphQLEnumType({
          name: this.User.name + this.Task.name + 'ConnectionOrder',
          values: {
            ID: { value: [this.Task.primaryKeyAttribute, 'ASC'] },
            LATEST: { value: ['createdAt', 'DESC'] },
            CUSTOM: {
              value: [
                Sequelize.literal(`
                CASE
                  WHEN completed = true THEN ${queryGenerator.quoteIdentifier(
                    'createdAt'
                  )}
                  ELSE ${queryGenerator.quoteIdentifier('otherDate')} End`),
                'DESC',
              ],
            },
            NAME: { value: ['name', 'ASC'] },
          },
        }),
        connectionFields: () => ({
          totalCount: {
            type: GraphQLInt,
            resolve(connection, args, { logging }) {
              self.userTaskConnectionFieldSpy(connection)
              return connection.source.countTasks({
                where: connection.where,
                logging,
              })
            },
          },
        }),
        where: (key, value, prevWhere) => {
          if (key === 'completed') {
            value = !!value
          }
          if (key === 'timeRangeOne') {
            const existingWhere = prevWhere.createdAt || {}
            return {
              createdAt: {
                ...existingWhere,
                [Op.gte]: new Date(now - 36000),
              },
            }
          }
          if (key === 'timeRangeTwo') {
            const existingWhere = prevWhere.createdAt || {}
            return {
              createdAt: {
                ...existingWhere,
                [Op.lte]: new Date(now - 24000),
              },
            }
          }
          return { [key]: value }
        },
      })

      this.orderByEnum = new GraphQLEnumType({
        name: this.User.name + this.Project.name + 'ConnectionOrder',
        values: {
          ID: { value: [this.Project.primaryKeyAttribute, 'ASC'] },
          LATEST: { value: [this.Project.primaryKeyAttribute, 'DESC'] },
        },
      })

      this.userProjectConnection = sequelizeConnection({
        name: 'userProject',
        nodeType: this.projectType,
        target: this.User.Projects,
        orderBy: this.orderByEnum,
        edgeFields: {
          isOwner: {
            type: GraphQLBoolean,
            resolve(edge) {
              return edge.node.ownerId === edge.source.id
            },
          },
        },
      })

      this.userProjectConnection2 = new GraphQLObjectType({
        name: 'UserProjectConnection2',
        fields: {
          edges: {
            type: new GraphQLList(
              new GraphQLObjectType({
                name: 'UserProjectEdge2',
                fields: {
                  node: {
                    type: this.projectType,
                  },
                },
              })
            ),
          },
        },
      })

      this.userProjectConnection2Resolver = createConnectionResolver({
        target: this.User.Projects,
        orderBy: this.orderByEnum.name,
      })

      this.userType = new GraphQLObjectType({
        name: this.User.name,
        fields: {
          ...attributeFields(this.User),
          id: globalIdField(this.User.name),
          tasks: {
            type: this.userTaskConnection.connectionType,
            args: {
              ...this.userTaskConnection.connectionArgs,
              completed: {
                type: GraphQLBoolean,
              },
              timeRangeOne: {
                type: GraphQLBoolean,
              },
              timeRangeTwo: {
                type: GraphQLBoolean,
              },
            },
            resolve: this.userTaskConnection.resolve,
          },
          projects: {
            type: this.userProjectConnection.connectionType,
            args: this.userProjectConnection.connectionArgs,
            resolve: this.userProjectConnection.resolve,
          },
          projects2: {
            type: this.userProjectConnection2,
            args: this.userProjectConnection.connectionArgs,
            resolve: this.userProjectConnection2Resolver.resolveConnection,
          },
        },
      })
      this.viewerTaskConnection = sequelizeConnection({
        name: 'Viewer' + this.Task.name,
        nodeType: this.taskType,
        target: this.Task,
        orderBy: new GraphQLEnumType({
          name: 'Viewer' + this.Task.name + 'ConnectionOrder',
          values: {
            ID: { value: [this.Task.primaryKeyAttribute, 'ASC'] },
          },
        }),
        before: (options, args, { viewer }) => {
          options.where = options.where || {}
          options.where.userId = viewer.get('id')
          return options
        },
      })
      this.viewerType = new GraphQLObjectType({
        name: 'Viewer',
        fields: {
          tasks: {
            type: this.viewerTaskConnection.connectionType,
            args: this.viewerTaskConnection.connectionArgs,
            resolve: this.viewerTaskConnection.resolve,
          },
        },
      })
      this.schema = new GraphQLSchema({
        query: new GraphQLObjectType({
          name: 'RootQueryType',
          fields: {
            user: {
              type: this.userType,
              args: {
                id: {
                  type: new GraphQLNonNull(GraphQLInt),
                },
              },
              resolve: resolver(this.User),
            },
            viewer: {
              type: this.viewerType,
              resolve(source, args, { viewer }) {
                return viewer
              },
            },
          },
        }),
      })

      await sequelize.sync({ force: true })

      let now = new Date(2015, 10, 17, 3, 24, 0, 0)

      this.taskId = 0

      this.projectA = await this.Project.create({})
      this.projectB = await this.Project.create({})
      this.projectC = await this.Project.create({})
      this.projectD = await this.Project.create({})
      this.projectE = await this.Project.create({})

      this.userA = await this.User.create(
        {
          [this.User.Tasks.as]: [
            {
              id: ++this.taskId,
              name: 'AAA',
              createdAt: new Date(now - 45000),
              otherDate: new Date(now - 45000),
              projectId: this.projectA.get('id'),
              completed: false,
            },
            {
              id: ++this.taskId,
              name: 'ABA',
              createdAt: new Date(now - 40000),
              otherDate: new Date(now - 40000),
              projectId: this.projectA.get('id'),
              completed: true,
            },
            {
              id: ++this.taskId,
              name: 'ABC',
              createdAt: new Date(now - 35000),
              otherDate: new Date(now - 35000),
              projectId: this.projectA.get('id'),
              completed: true,
            },
            {
              id: ++this.taskId,
              name: 'ABC',
              createdAt: new Date(now - 30000),
              otherDate: new Date(now - 30000),
              projectId: this.projectA.get('id'),
              completed: false,
            },
            {
              id: ++this.taskId,
              name: 'BAA',
              createdAt: new Date(now - 25000),
              otherDate: new Date(now - 25000),
              projectId: this.projectA.get('id'),
              completed: false,
            },
            {
              id: ++this.taskId,
              name: 'BBB',
              createdAt: new Date(now - 20000),
              otherDate: new Date(now - 20000),
              projectId: this.projectB.get('id'),
              completed: true,
            },
            {
              id: ++this.taskId,
              name: 'CAA',
              createdAt: new Date(now - 15000),
              otherDate: new Date(now - 15000),
              projectId: this.projectB.get('id'),
              completed: true,
            },
            {
              id: ++this.taskId,
              name: 'CCC',
              createdAt: new Date(now - 10000),
              otherDate: new Date(now - 10000),
              projectId: this.projectB.get('id'),
              completed: false,
            },
            {
              id: ++this.taskId,
              name: 'DDD',
              createdAt: new Date(now - 5000),
              otherDate: new Date(now - 5000),
              projectId: this.projectB.get('id'),
              completed: false,
            },
          ],
        },
        {
          include: [this.User.Tasks],
        }
      )

      this.userB = await this.User.create(
        {
          [this.User.Tasks.as]: [
            {
              id: ++this.taskId,
              name: 'ZAA',
              createdAt: new Date(now - 45000),
              otherDate: new Date(now - 45000),
              projectId: this.projectA.get('id'),
              completed: true,
            },
            {
              id: ++this.taskId,
              name: 'ZAB',
              createdAt: new Date(now - 45000),
              otherDate: new Date(now - 45000),
              projectId: this.projectA.get('id'),
              completed: true,
            },
            {
              id: ++this.taskId,
              name: 'ZAC',
              createdAt: new Date(now - 45000),
              otherDate: new Date(now - 45000),
              projectId: this.projectA.get('id'),
              completed: true,
            },
          ],
        },
        {
          include: [this.User.Tasks],
        }
      )

      await this.projectA.update({
        ownerId: this.userA.get('id'),
      })
      await this.ProjectMember.create({
        projectId: this.projectA.get('id'),
        userId: this.userA.get('id'),
      })
      await this.ProjectMember.create({
        projectId: this.projectB.get('id'),
        userId: this.userA.get('id'),
      })
      await this.ProjectMember.create({
        projectId: this.projectC.get('id'),
        userId: this.userA.get('id'),
      })
      await this.ProjectMember.create({
        projectId: this.projectD.get('id'),
        userId: this.userA.get('id'),
      })
      await this.ProjectMember.create({
        projectId: this.projectE.get('id'),
        userId: this.userA.get('id'),
      })
    })

    it('should not duplicate attributes', async function () {
      let sqlSpy = sinon.spy()

      let projectConnectionAttributesUnique

      const userProjectConnection = sequelizeConnection({
        name: 'userProject',
        nodeType: this.projectType,
        target: this.User.Projects,
        before(options) {
          // compare a uniq set of attributes against what is returned by the sequelizeConnection resolver
          let getUnique = uniq(options.attributes)
          projectConnectionAttributesUnique =
            getUnique.length === options.attributes.length
        },
      })

      const userType = new GraphQLObjectType({
        name: this.User.name,
        fields: {
          ...attributeFields(this.User),
          id: globalIdField(this.User.name),
          projects: {
            type: userProjectConnection.connectionType,
            args: userProjectConnection.connectionArgs,
            resolve: userProjectConnection.resolve,
          },
        },
      })

      const schema = new GraphQLSchema({
        query: new GraphQLObjectType({
          name: 'RootQueryType',
          fields: {
            user: {
              type: userType,
              args: {
                id: {
                  type: new GraphQLNonNull(GraphQLInt),
                },
              },
              resolve: resolver(this.User),
            },
            viewer: {
              type: this.viewerType,
              resolve(source, args, { viewer }) {
                return viewer
              },
            },
          },
        }),
      })

      await graphql(
        schema,
        `
        {
          user(id: ${this.userA.id}) {
            projects {
              edges {
                node {
                  tasks {
                    edges {
                      cursor
                      node {
                        id
                        name
                      }
                    }
                  }
                }
              }
            }
          }
        }
      `,
        null,
        {
          logging: sqlSpy,
        }
      )

      expect(projectConnectionAttributesUnique).to.equal(true)
    })

    it('should handle orderBy function case', async function () {
      const result = await graphql(
        this.schema,
        `
        {
          user(id: ${this.userA.id}) {
            projects(first: 1) {
              edges {
                node {
                  tasks(orderBy: NAME_FUNC, first: 5) {
                    edges {
                      cursor
                      node {
                        id
                        name
                      }
                    }
                  }
                }
              }
            }
          }
        }
      `,
        null,
        {}
      )

      if (result.errors) throw new Error(result.errors[0])

      expect(this.projectOrderSpy).to.have.been.calledOnce
      expect(this.projectOrderSpy.alwaysCalledWithMatch({}, { first: 5 })).to.be
        .ok
    })

    it('should support connectionResolver orderBy enum references via name', async function () {
      const result = await graphql(
        this.schema,
        `
        {
          user(id: ${this.userA.id}) {
            projects2(orderBy: LATEST) {
              edges {
                node {
                  id
                }
              }
            }
          }
        }
      `,
        null,
        {}
      )

      if (result.errors) throw new Error(result.errors[0])

      const node = result.data.user.projects2.edges[0].node
      expect(+fromGlobalId(node.id).id).to.equal(5)
    })

    it('should properly reverse orderBy with NULLS and last', async function () {
      let sqlSpy = sinon.spy()
      await graphql(
        this.schema,
        `
        {
          user(id: ${this.userA.id}) {
            projects(first: 1) {
              edges {
                node {
                  tasks(orderBy: NAME_NULLS_LAST, last: 10) {
                    edges {
                      cursor
                      node {
                        id
                        name
                      }
                    }
                  }
                }
              }
            }
          }
        }
      `,
        null,
        { logging: sqlSpy }
      )

      expect(sqlSpy.lastCall.args[0].match('DESC NULLS LAST')).to.be.ok
    })

    it('should support in-query slicing and pagination with first and orderBy', async function () {
      let firstThree = this.userA.tasks.slice(
        this.userA.tasks.length - 3,
        this.userA.tasks.length
      )
      let nextThree = this.userA.tasks.slice(
        this.userA.tasks.length - 6,
        this.userA.tasks.length - 3
      )
      let lastThree = this.userA.tasks.slice(
        this.userA.tasks.length - 9,
        this.userA.tasks.length - 6
      )

      expect(firstThree.length).to.equal(3)
      expect(nextThree.length).to.equal(3)
      expect(lastThree.length).to.equal(3)

      let verify = function (result, expectedTasks) {
        if (result.errors) throw new Error(result.errors[0].stack)

        var resultTasks = result.data.user.tasks.edges.map(function (edge) {
          return edge.node
        })

        let resultIds = resultTasks
          .map((task) => {
            return parseInt(fromGlobalId(task.id).id, 10)
          })
          .sort()

        let expectedIds = expectedTasks
          .map(function (task) {
            return task.get('id')
          })
          .sort()

        expect(resultTasks.length).to.equal(3)
        expect(resultIds).to.deep.equal(expectedIds)
      }

      let query = (after) => {
        return graphql(
          this.schema,
          `
          {
            user(id: ${this.userA.id}) {
              tasks(first: 3, ${
                after ? 'after: "' + after + '", ' : ''
              } orderBy: LATEST) {
                edges {
                  cursor
                  node {
                    id
                    name
                  }
                }
                pageInfo {
                  hasNextPage
                  hasPreviousPage
                  endCursor
                }
              }
            }
          }
        `,
          null,
          {}
        )
      }

      let firstResult = await query()
      verify(firstResult, firstThree)
      expect(firstResult.data.user.tasks.pageInfo.hasNextPage).to.equal(true)
      expect(firstResult.data.user.tasks.pageInfo.hasPreviousPage).to.equal(
        false
      )

      let nextResult = await query(
        firstResult.data.user.tasks.pageInfo.endCursor
      )
      verify(nextResult, nextThree)
      expect(nextResult.data.user.tasks.pageInfo.hasNextPage).to.equal(true)
      expect(nextResult.data.user.tasks.pageInfo.hasPreviousPage).to.equal(true)

      let lastResult = await query(nextResult.data.user.tasks.edges[2].cursor)
      verify(lastResult, lastThree)
      expect(lastResult.data.user.tasks.pageInfo.hasNextPage).to.equal(false)
      expect(lastResult.data.user.tasks.pageInfo.hasPreviousPage).to.equal(true)
    })

    it('should support in-query slicing and pagination with first and CUSTOM orderBy', async function () {
      const correctOrder = await graphql(
        this.schema,
        `
        {
          user(id: ${this.userA.id}) {
            tasks(first: 9, orderBy: CUSTOM) {
              edges {
                cursor
                node {
                  id
                  name
                }
              }
              pageInfo {
                hasNextPage
                endCursor
              }
            }
          }
        }
      `
      )
      const reordered = correctOrder.data.user.tasks.edges.map(({ node }) => {
        const targetId = fromGlobalId(node.id).id
        return this.userA.tasks.find((task) => {
          return task.id === Number(targetId)
        })
      })

      let lastThree = reordered.slice(
        this.userA.tasks.length - 3,
        this.userA.tasks.length
      )
      let nextThree = reordered.slice(
        this.userA.tasks.length - 6,
        this.userA.tasks.length - 3
      )
      let firstThree = reordered.slice(
        this.userA.tasks.length - 9,
        this.userA.tasks.length - 6
      )

      expect(firstThree.length).to.equal(3)
      expect(nextThree.length).to.equal(3)
      expect(lastThree.length).to.equal(3)

      let verify = function (result, expectedTasks) {
        if (result.errors) throw new Error(result.errors[0].stack)

        var resultTasks = result.data.user.tasks.edges.map(function (edge) {
          return edge.node
        })

        let resultIds = resultTasks
          .map((task) => {
            return parseInt(fromGlobalId(task.id).id, 10)
          })
          .sort()

        let expectedIds = expectedTasks
          .map(function (task) {
            return task.get('id')
          })
          .sort()

        expect(resultTasks.length).to.equal(3)
        expect(resultIds).to.deep.equal(expectedIds)
      }

      let query = (after) => {
        return graphql(
          this.schema,
          `
          {
            user(id: ${this.userA.id}) {
              tasks(first: 3, ${
                after ? 'after: "' + after + '", ' : ''
              } orderBy: CUSTOM) {
                edges {
                  cursor
                  node {
                    id
                    name
                  }
                }
                pageInfo {
                  hasNextPage
                  hasPreviousPage
                  endCursor
                }
              }
            }
          }
        `
        )
      }

      let firstResult = await query()
      verify(firstResult, firstThree)
      expect(firstResult.data.user.tasks.pageInfo.hasNextPage).to.equal(true)
      expect(firstResult.data.user.tasks.pageInfo.hasPreviousPage).to.equal(
        false
      )

      let nextResult = await query(
        firstResult.data.user.tasks.pageInfo.endCursor
      )
      verify(nextResult, nextThree)
      expect(nextResult.data.user.tasks.pageInfo.hasNextPage).to.equal(true)
      expect(nextResult.data.user.tasks.pageInfo.hasPreviousPage).to.equal(true)

      let lastResult = await query(nextResult.data.user.tasks.edges[2].cursor)
      verify(lastResult, lastThree)
      expect(lastResult.data.user.tasks.pageInfo.hasNextPage).to.equal(false)
      expect(lastResult.data.user.tasks.pageInfo.hasPreviousPage).to.equal(true)
    })

    it('should optimize in-query slicing and pagination with first and orderBy, when only requesting endCursor', async function () {
      let firstThree = this.userA.tasks.slice(
        this.userA.tasks.length - 3,
        this.userA.tasks.length
      )
      let nextThree = this.userA.tasks.slice(
        this.userA.tasks.length - 6,
        this.userA.tasks.length - 3
      )
      let lastThree = this.userA.tasks.slice(
        this.userA.tasks.length - 9,
        this.userA.tasks.length - 6
      )

      expect(firstThree.length).to.equal(3)
      expect(nextThree.length).to.equal(3)
      expect(lastThree.length).to.equal(3)

      let query = (after, { full } = {}) => {
        return graphql(
          this.schema,
          `
          {
            user(id: ${this.userA.id}) {
              tasks(first: 3, ${
                after ? 'after: "' + after + '", ' : ''
              }, orderBy: LATEST) {
                ${
                  full
                    ? `edges {
                  cursor
                  node {
                    id
                    name
                  }
                }`
                    : ''
                }
                pageInfo {
                  hasNextPage
                  hasPreviousPage
                  endCursor
                }
              }
            }
          }
        `,
          null,
          {}
        )
      }

      let firstResult = await query(null, { full: true })
      let firstResultNoEdges = await query()
      expect(firstResultNoEdges.data.user.tasks.pageInfo).to.deep.equal(
        firstResult.data.user.tasks.pageInfo
      )
      expect(firstResult.data.user.tasks.pageInfo.hasNextPage).to.equal(true)
      expect(firstResult.data.user.tasks.pageInfo.hasPreviousPage).to.equal(
        false
      )

      let nextResult = await query(
        firstResult.data.user.tasks.pageInfo.endCursor,
        { full: true }
      )
      let nextResultNoEdges = await query(
        firstResult.data.user.tasks.pageInfo.endCursor
      )
      expect(nextResultNoEdges.data.user.tasks.pageInfo).to.deep.equal(
        nextResult.data.user.tasks.pageInfo
      )
      expect(nextResult.data.user.tasks.pageInfo.hasNextPage).to.equal(true)
      expect(nextResult.data.user.tasks.pageInfo.hasPreviousPage).to.equal(true)

      let lastResult = await query(
        nextResult.data.user.tasks.pageInfo.endCursor,
        { full: true }
      )
      let lastResultNoEdges = await query(
        nextResult.data.user.tasks.pageInfo.endCursor
      )
      expect(lastResultNoEdges.data.user.tasks.pageInfo).to.deep.equal(
        lastResult.data.user.tasks.pageInfo
      )
      expect(lastResult.data.user.tasks.pageInfo.hasNextPage).to.equal(false)
      expect(lastResult.data.user.tasks.pageInfo.hasPreviousPage).to.equal(true)
    })

    it('should support in-query slicing and pagination with first and CUSTOM orderBy', async function () {
      const correctOrder = await graphql(
        this.schema,
        `
        {
          user(id: ${this.userA.id}) {
            tasks(first: 9, orderBy: CUSTOM) {
              edges {
                cursor
                node {
                  id
                  name
                }
              }
              pageInfo {
                hasNextPage
                endCursor
              }
            }
          }
        }
      `
      )
      const reordered = correctOrder.data.user.tasks.edges.map(({ node }) => {
        const targetId = fromGlobalId(node.id).id
        return this.userA.tasks.find((task) => {
          return task.id === Number(targetId)
        })
      })

      let lastThree = reordered.slice(
        this.userA.tasks.length - 3,
        this.userA.tasks.length
      )
      let nextThree = reordered.slice(
        this.userA.tasks.length - 6,
        this.userA.tasks.length - 3
      )
      let firstThree = reordered.slice(
        this.userA.tasks.length - 9,
        this.userA.tasks.length - 6
      )

      expect(firstThree.length).to.equal(3)
      expect(nextThree.length).to.equal(3)
      expect(lastThree.length).to.equal(3)

      let verify = function (result, expectedTasks) {
        if (result.errors) throw new Error(result.errors[0].stack)

        var resultTasks = result.data.user.tasks.edges.map(function (edge) {
          return edge.node
        })

        let resultIds = resultTasks
          .map((task) => {
            return parseInt(fromGlobalId(task.id).id, 10)
          })
          .sort()

        let expectedIds = expectedTasks
          .map(function (task) {
            return task.get('id')
          })
          .sort()

        expect(resultTasks.length).to.equal(3)
        expect(resultIds).to.deep.equal(expectedIds)
      }

      let query = (after) => {
        return graphql(
          this.schema,
          `
          {
            user(id: ${this.userA.id}) {
              tasks(first: 3, ${
                after ? 'after: "' + after + '", ' : ''
              } orderBy: CUSTOM) {
                edges {
                  cursor
                  node {
                    id
                    name
                  }
                }
                pageInfo {
                  hasNextPage
                  hasPreviousPage
                  endCursor
                }
              }
            }
          }
        `
        )
      }

      let firstResult = await query()
      verify(firstResult, firstThree)
      expect(firstResult.data.user.tasks.pageInfo.hasNextPage).to.equal(true)
      expect(firstResult.data.user.tasks.pageInfo.hasPreviousPage).to.equal(
        false
      )

      let nextResult = await query(
        firstResult.data.user.tasks.pageInfo.endCursor
      )
      verify(nextResult, nextThree)
      expect(nextResult.data.user.tasks.pageInfo.hasNextPage).to.equal(true)
      expect(nextResult.data.user.tasks.pageInfo.hasPreviousPage).to.equal(true)

      let lastResult = await query(nextResult.data.user.tasks.edges[2].cursor)
      verify(lastResult, lastThree)
      expect(lastResult.data.user.tasks.pageInfo.hasNextPage).to.equal(false)
      expect(lastResult.data.user.tasks.pageInfo.hasPreviousPage).to.equal(true)
    })

    it('should optimize in-query slicing and pagination with first and CUSTOM orderBy when only endCursor is requested', async function () {
      const correctOrder = await graphql(
        this.schema,
        `
        {
          user(id: ${this.userA.id}) {
            tasks(first: 9, orderBy: CUSTOM) {
              edges {
                cursor
                node {
                  id
                  name
                }
              }
              pageInfo {
                hasNextPage
                endCursor
              }
            }
          }
        }
      `
      )
      const reordered = correctOrder.data.user.tasks.edges.map(({ node }) => {
        const targetId = fromGlobalId(node.id).id
        return this.userA.tasks.find((task) => {
          return task.id === Number(targetId)
        })
      })

      let lastThree = reordered.slice(
        this.userA.tasks.length - 3,
        this.userA.tasks.length
      )
      let nextThree = reordered.slice(
        this.userA.tasks.length - 6,
        this.userA.tasks.length - 3
      )
      let firstThree = reordered.slice(
        this.userA.tasks.length - 9,
        this.userA.tasks.length - 6
      )

      expect(firstThree.length).to.equal(3)
      expect(nextThree.length).to.equal(3)
      expect(lastThree.length).to.equal(3)

      let verify = function (result, expectedTasks) {
        if (result.errors) throw new Error(result.errors[0].stack)

        var resultTasks = result.data.user.tasks.edges.map(function (edge) {
          return edge.node
        })

        let resultIds = resultTasks
          .map((task) => {
            return parseInt(fromGlobalId(task.id).id, 10)
          })
          .sort()

        let expectedIds = expectedTasks
          .map(function (task) {
            return task.get('id')
          })
          .sort()

        expect(resultTasks.length).to.equal(3)
        expect(resultIds).to.deep.equal(expectedIds)
      }

      let query = (after, { full } = {}) => {
        return graphql(
          this.schema,
          `
          {
            user(id: ${this.userA.id}) {
              tasks(first: 3, ${
                after ? 'after: "' + after + '", ' : ''
              } orderBy: CUSTOM) {
                ${
                  full
                    ? `edges {
                  cursor
                  node {
                    id
                    name
                  }
                }`
                    : ''
                }
                pageInfo {
                  hasNextPage
                  hasPreviousPage
                  endCursor
                }
              }
            }
          }
        `
        )
      }

      let firstResult = await query(null, { full: true })
      let firstResultNoEdges = await query()
      expect(firstResultNoEdges.data.user.tasks.pageInfo).to.deep.equal(
        firstResult.data.user.tasks.pageInfo
      )
      verify(firstResult, firstThree)
      expect(firstResult.data.user.tasks.pageInfo.hasNextPage).to.equal(true)
      expect(firstResult.data.user.tasks.pageInfo.hasPreviousPage).to.equal(
        false
      )

      let nextResult = await query(
        firstResult.data.user.tasks.pageInfo.endCursor,
        { full: true }
      )
      let nextResultNoEdges = await query(
        firstResult.data.user.tasks.pageInfo.endCursor
      )
      expect(nextResultNoEdges.data.user.tasks.pageInfo).to.deep.equal(
        nextResult.data.user.tasks.pageInfo
      )
      verify(nextResult, nextThree)
      expect(nextResult.data.user.tasks.pageInfo.hasNextPage).to.equal(true)
      expect(nextResult.data.user.tasks.pageInfo.hasPreviousPage).to.equal(true)

      let lastResult = await query(nextResult.data.user.tasks.edges[2].cursor, {
        full: true,
      })
      let lastResultNoEdges = await query(
        nextResult.data.user.tasks.edges[2].cursor
      )
      expect(lastResultNoEdges.data.user.tasks.pageInfo).to.deep.equal(
        lastResult.data.user.tasks.pageInfo
      )
      verify(lastResult, lastThree)
      expect(lastResult.data.user.tasks.pageInfo.hasNextPage).to.equal(false)
      expect(lastResult.data.user.tasks.pageInfo.hasPreviousPage).to.equal(true)
    })

    it('should support pagination with where', async function () {
      const completedTasks = this.userA.tasks.filter((task) => task.completed)

      expect(completedTasks.length).to.equal(4)

      let firstThree = completedTasks.slice(0, 3)
      let nextThree = completedTasks.slice(3, 6)

      expect(firstThree.length).to.equal(3)
      expect(nextThree.length).to.equal(1)

      let verify = function (result, expectedTasks) {
        if (result.errors) throw new Error(result.errors[0].stack)

        var resultTasks = result.data.user.tasks.edges.map(function (edge) {
          return edge.node
        })

        let resultIds = resultTasks
          .map((task) => {
            return parseInt(fromGlobalId(task.id).id, 10)
          })
          .sort()

        let expectedIds = expectedTasks
          .map(function (task) {
            return task.get('id')
          })
          .sort()

        expect(resultTasks.length).to.equal(expectedTasks.length)
        expect(resultIds).to.deep.equal(expectedIds)
      }

      let query = (after) => {
        return graphql(
          this.schema,
          `
          {
            user(id: ${this.userA.id}) {
              tasks(first: 3, ${
                after ? 'after: "' + after + '", ' : ''
              } completed: true) {
                edges {
                  cursor
                  node {
                    id
                    name
                  }
                }
                pageInfo {
                  hasNextPage
                  hasPreviousPage
                  endCursor
                }
              }
            }
          }
        `,
          null,
          {}
        )
      }

      let firstResult = await query()
      verify(firstResult, firstThree)
      expect(firstResult.data.user.tasks.pageInfo.hasNextPage).to.equal(true)
      expect(firstResult.data.user.tasks.pageInfo.hasPreviousPage).to.equal(
        false
      )

      let nextResult = await query(
        firstResult.data.user.tasks.pageInfo.endCursor
      )
      verify(nextResult, nextThree)
      expect(nextResult.data.user.tasks.pageInfo.hasNextPage).to.equal(false)
      expect(nextResult.data.user.tasks.pageInfo.hasPreviousPage).to.equal(true)
    })

    it('should support pagination on N:M', async function () {
      let query = (after) => {
        return graphql(
          this.schema,
          `
          {
            user(id: ${this.userA.id}) {
              projects(first: 2, ${after ? 'after: "' + after + '", ' : ''}) {
                edges {
                  cursor
                  node {
                    id
                  }
                }
                pageInfo {
                  hasNextPage
                  hasPreviousPage
                  endCursor
                }
              }
            }
          }
        `,
          null,
          {}
        )
      }

      let firstResult = await query()
      expect(firstResult.data.user.projects.pageInfo.hasNextPage).to.equal(true)
      expect(firstResult.data.user.projects.pageInfo.hasPreviousPage).to.equal(
        false
      )

      let nextResult = await query(
        firstResult.data.user.projects.pageInfo.endCursor
      )
      expect(nextResult.data.user.projects.pageInfo.hasNextPage).to.equal(true)
      expect(nextResult.data.user.projects.pageInfo.hasPreviousPage).to.equal(
        true
      )

      let thirdResult = await query(
        nextResult.data.user.projects.pageInfo.endCursor
      )
      expect(thirdResult.data.user.projects.pageInfo.hasNextPage).to.equal(
        false
      )
      expect(thirdResult.data.user.projects.pageInfo.hasPreviousPage).to.equal(
        true
      )
    })

    it('should support in-query slicing with user provided args/where', async function () {
      let result = await graphql(
        this.schema,
        `
        {
          user(id: ${this.userA.id}) {
            tasks(first: 2, completed: true, orderBy: LATEST) {
              edges {
                cursor
                node {
                  id
                  name
                }
              }
            }
          }
        }
      `,
        null,
        {}
      )

      if (result.errors) throw new Error(result.errors[0].stack)

      expect(result.data.user.tasks.edges.length).to.equal(2)
      expect(
        result.data.user.tasks.edges.map((task) => {
          return parseInt(fromGlobalId(task.node.id).id, 10)
        })
      ).to.deep.equal([this.userA.tasks[6].id, this.userA.tasks[5].id])
    })

    it('should support multiple user provided args/where that act on a single database field', async function () {
      let result = await graphql(
        this.schema,
        `
        {
          user(id: ${this.userA.id}) {
            tasks(first: 5, orderBy: LATEST, timeRangeOne: true, timeRangeTwo: true) {
              edges {
                cursor
                node {
                  id
                  name
                }
              }
            }
          }
        }
      `,
        null,
        {}
      )

      if (result.errors) throw new Error(result.errors[0].stack)

      expect(result.data.user.tasks.edges.length).to.equal(3)
      expect(
        result.data.user.tasks.edges.map((task) => {
          return parseInt(fromGlobalId(task.node.id).id, 10)
        })
      ).to.deep.equal([
        this.userA.tasks[4].id,
        this.userA.tasks[3].id,
        this.userA.tasks[2].id,
      ])
    })

    it('should support nested aliased fields', async function () {
      let result = await graphql(
        this.schema,
        `
        {
          user(id: ${this.userA.id}) {
            tasks(first: 1, completed: true, orderBy: LATEST) {
              edges {
                node {
                  id
                  title: name
                }
              }
            }
          }
        }
      `,
        null,
        {}
      )

      if (result.errors) throw new Error(result.errors[0].stack)
      expect(result.data.user.tasks.edges[0].node.title).to.equal('CAA')
    })

    it('should support reverse pagination with last and orderBy', async function () {
      let firstThree = this.userA.tasks.slice(0, 3)
      let nextThree = this.userA.tasks.slice(3, 6)
      let lastThree = this.userA.tasks.slice(6, 9)

      expect(firstThree.length).to.equal(3)
      expect(nextThree.length).to.equal(3)
      expect(lastThree.length).to.equal(3)

      let verify = function (result, expectedTasks) {
        if (result.errors) throw new Error(result.errors[0].stack)

        var resultTasks = result.data.user.tasks.edges.map(function (edge) {
          return edge.node
        })

        let resultIds = resultTasks
          .map((task) => {
            return parseInt(fromGlobalId(task.id).id, 10)
          })
          .sort()

        let expectedIds = expectedTasks
          .map(function (task) {
            return task.get('id')
          })
          .sort()

        expect(resultTasks.length).to.equal(3)
        expect(resultIds).to.deep.equal(expectedIds)
      }

      let query = (before) => {
        return graphql(
          this.schema,
          `
          {
            user(id: ${this.userA.id}) {
              tasks(last: 3, ${
                before ? 'before: "' + before + '", ' : ''
              } orderBy: LATEST) {
                edges {
                  cursor
                  node {
                    id
                    name
                  }
                }
                pageInfo {
                  hasNextPage
                  hasPreviousPage
                  startCursor
                }
              }
            }
          }
        `,
          null,
          {}
        )
      }

      let firstResult = await query()

      verify(firstResult, firstThree)
      expect(firstResult.data.user.tasks.pageInfo.hasNextPage).to.equal(false)
      expect(firstResult.data.user.tasks.pageInfo.hasPreviousPage).to.equal(
        true
      )

      let nextResult = await query(
        firstResult.data.user.tasks.pageInfo.startCursor
      )
      verify(nextResult, nextThree)
      expect(nextResult.data.user.tasks.pageInfo.hasNextPage).to.equal(true)
      expect(nextResult.data.user.tasks.pageInfo.hasPreviousPage).to.equal(true)

      let lastResult = await query(nextResult.data.user.tasks.edges[0].cursor)
      verify(lastResult, lastThree)
      expect(lastResult.data.user.tasks.pageInfo.hasNextPage).to.equal(true)
      expect(lastResult.data.user.tasks.pageInfo.hasPreviousPage).to.equal(
        false
      )
    })

    it('should optimize reverse pagination with last and orderBy when only startCursor is selected', async function () {
      let firstThree = this.userA.tasks.slice(0, 3)
      let nextThree = this.userA.tasks.slice(3, 6)
      let lastThree = this.userA.tasks.slice(6, 9)

      expect(firstThree.length).to.equal(3)
      expect(nextThree.length).to.equal(3)
      expect(lastThree.length).to.equal(3)

      let query = (before, { full } = {}) => {
        return graphql(
          this.schema,
          `
          {
            user(id: ${this.userA.id}) {
              tasks(last: 3, ${
                before ? 'before: "' + before + '", ' : ''
              } orderBy: LATEST) {
                ${
                  full
                    ? `edges {
                  cursor
                  node {
                    id
                    name
                  }
                }`
                    : ''
                }
                pageInfo {
                  hasNextPage
                  hasPreviousPage
                  startCursor
                }
              }
            }
          }
        `,
          null,
          {}
        )
      }

      let firstResult = await query(null, { full: true })
      let firstResultNoEdges = await query()
      expect(firstResultNoEdges.data.user.tasks.pageInfo).to.deep.equal(
        firstResult.data.user.tasks.pageInfo
      )
      expect(firstResult.data.user.tasks.pageInfo.hasNextPage).to.equal(false)
      expect(firstResult.data.user.tasks.pageInfo.hasPreviousPage).to.equal(
        true
      )

      let nextResult = await query(
        firstResult.data.user.tasks.pageInfo.startCursor,
        { full: true }
      )
      let nextResultNoEdges = await query(
        firstResult.data.user.tasks.pageInfo.startCursor
      )
      expect(nextResultNoEdges.data.user.tasks.pageInfo).to.deep.equal(
        nextResult.data.user.tasks.pageInfo
      )
      expect(nextResult.data.user.tasks.pageInfo.hasNextPage).to.equal(true)
      expect(nextResult.data.user.tasks.pageInfo.hasPreviousPage).to.equal(true)

      let lastResult = await query(nextResult.data.user.tasks.edges[0].cursor, {
        full: true,
      })
      let lastResultNoEdges = await query(
        nextResult.data.user.tasks.edges[0].cursor
      )
      expect(lastResultNoEdges.data.user.tasks.pageInfo).to.deep.equal(
        lastResult.data.user.tasks.pageInfo
      )
      expect(lastResult.data.user.tasks.pageInfo.hasNextPage).to.equal(true)
      expect(lastResult.data.user.tasks.pageInfo.hasPreviousPage).to.equal(
        false
      )
    })

    it('should optimize reverse pagination with last and orderBy when only startCursor is selected', async function () {
      let firstThree = this.userA.tasks.slice(0, 3)
      let nextThree = this.userA.tasks.slice(3, 6)
      let lastThree = this.userA.tasks.slice(6, 9)

      expect(firstThree.length).to.equal(3)
      expect(nextThree.length).to.equal(3)
      expect(lastThree.length).to.equal(3)

      let query = (before, { full } = {}) => {
        return graphql(
          this.schema,
          `
          {
            user(id: ${this.userA.id}) {
              tasks(last: 3, ${
                before ? 'before: "' + before + '", ' : ''
              } orderBy: LATEST) {
                ${
                  full
                    ? `edges {
                  cursor
                  node {
                    id
                    name
                  }
                }`
                    : ''
                }
                pageInfo {
                  hasNextPage
                  hasPreviousPage
                  startCursor
                }
              }
            }
          }
        `,
          null,
          {}
        )
      }

      let firstResult = await query(null, { full: true })
      let firstResultNoEdges = await query()
      expect(firstResultNoEdges.data.user.tasks.pageInfo).to.deep.equal(
        firstResult.data.user.tasks.pageInfo
      )
      expect(firstResult.data.user.tasks.pageInfo.hasNextPage).to.equal(false)
      expect(firstResult.data.user.tasks.pageInfo.hasPreviousPage).to.equal(
        true
      )

      let nextResult = await query(
        firstResult.data.user.tasks.pageInfo.startCursor,
        { full: true }
      )
      let nextResultNoEdges = await query(
        firstResult.data.user.tasks.pageInfo.startCursor
      )
      expect(nextResultNoEdges.data.user.tasks.pageInfo).to.deep.equal(
        nextResult.data.user.tasks.pageInfo
      )
      expect(nextResult.data.user.tasks.pageInfo.hasNextPage).to.equal(true)
      expect(nextResult.data.user.tasks.pageInfo.hasPreviousPage).to.equal(true)

      let lastResult = await query(nextResult.data.user.tasks.edges[0].cursor, {
        full: true,
      })
      let lastResultNoEdges = await query(
        nextResult.data.user.tasks.edges[0].cursor
      )
      expect(lastResultNoEdges.data.user.tasks.pageInfo).to.deep.equal(
        lastResult.data.user.tasks.pageInfo
      )
      expect(lastResult.data.user.tasks.pageInfo.hasNextPage).to.equal(true)
      expect(lastResult.data.user.tasks.pageInfo.hasPreviousPage).to.equal(
        false
      )
    })

    it('should support paging forward and backward', async function () {
      let oldestThree = this.userA.tasks.slice(0, 3).reverse()
      let middleThree = this.userA.tasks.slice(3, 6).reverse()
      let newestThree = this.userA.tasks.slice(6, 9).reverse()

      expect(oldestThree.length).to.equal(3)
      expect(middleThree.length).to.equal(3)
      expect(newestThree.length).to.equal(3)

      let verify = function (result, expectedTasks) {
        if (result.errors) throw new Error(result.errors[0].stack)

        var resultTasks = result.data.user.tasks.edges.map(function (edge) {
          return edge.node
        })

        let resultIds = resultTasks
          .map((task) => {
            return parseInt(fromGlobalId(task.id).id, 10)
          })
          .sort()

        let expectedIds = expectedTasks
          .map(function (task) {
            return task.get('id')
          })
          .sort()

        expect(resultTasks.length).to.equal(3)
        expect(resultIds).to.deep.equal(expectedIds)
      }

      let query = (variables = {}) => {
        return graphql(
          this.schema,
          `
          query ($first: Int, $before: String, $last: Int, $after: String) {
            user(id: ${this.userA.id}) {
              tasks(first: $first, before: $before, last: $last, after: $after, orderBy: LATEST) {
                edges {
                  cursor
                  node {
                    id
                    name
                  }
                }
                pageInfo {
                  hasNextPage
                  hasPreviousPage
                  startCursor
                  endCursor
                }
              }
            }
          }
        `,
          null,
          {},
          variables
        )
      }

      let result
      result = await query({ first: 3 })
      verify(result, newestThree)
      expect(result.data.user.tasks.pageInfo.hasNextPage).to.equal(true)
      expect(result.data.user.tasks.pageInfo.hasPreviousPage).to.equal(false)

      // go to next page
      result = await query({
        first: 3,
        after: result.data.user.tasks.pageInfo.endCursor,
      })
      verify(result, middleThree)
      expect(result.data.user.tasks.pageInfo.hasNextPage).to.equal(true)
      expect(result.data.user.tasks.pageInfo.hasPreviousPage).to.equal(true)

      // go to next page
      result = await query({
        first: 3,
        after: result.data.user.tasks.edges[2].cursor,
      })
      verify(result, oldestThree)
      expect(result.data.user.tasks.pageInfo.hasNextPage).to.equal(false)
      expect(result.data.user.tasks.pageInfo.hasPreviousPage).to.equal(true)

      // go to previous page
      result = await query({
        last: 3,
        before: result.data.user.tasks.pageInfo.startCursor,
      })
      verify(result, middleThree)
      expect(result.data.user.tasks.pageInfo.hasNextPage).to.equal(true)
      expect(result.data.user.tasks.pageInfo.hasPreviousPage).to.equal(true)

      // go to previous page
      result = await query({
        last: 3,
        before: result.data.user.tasks.edges[0].cursor,
      })
      verify(result, newestThree)
      expect(result.data.user.tasks.pageInfo.hasNextPage).to.equal(true)
      expect(result.data.user.tasks.pageInfo.hasPreviousPage).to.equal(false)
    })

    it('should support fetching the next element although it has the same orderValue', async function () {
      let firstResult = await graphql(
        this.schema,
        `
        {
          user(id: ${this.userA.id}) {
            tasks(first: 3, orderBy: NAME) {
              edges {
                cursor
                node {
                  id
                  name
                }
              }
              pageInfo {
                endCursor
              }
            }
          }
        }
      `,
        null,
        {}
      )

      let secondResult = await graphql(
        this.schema,
        `
        {
          user(id: ${this.userA.id}) {
            tasks(first: 3, after: "${firstResult.data.user.tasks.pageInfo.endCursor}", orderBy: NAME) {
              edges {
                cursor
                node {
                  id
                  name
                }
              }
              pageInfo {
                endCursor
              }
            }
          }
        }
      `,
        null,
        {}
      )

      expect(firstResult.data.user.tasks.edges[2].node.name).to.equal('ABC')
      expect(firstResult.data.user.tasks.edges[2].node.name).to.equal(
        secondResult.data.user.tasks.edges[0].node.name
      )
    })

    it('should support prefetching two nested connections', async function () {
      let result = await graphql(
        this.schema,
        `
        {
          user(id: ${this.userA.id}) {
            projects {
              edges {
                node {
                  tasks {
                    edges {
                      cursor
                      node {
                        id
                        name
                      }
                    }
                  }
                }
              }
            }
          }
        }
      `,
        null
      )

      if (result.errors) throw new Error(result.errors[0].stack)

      const nodeNames = result.data.user.projects.edges.map((edge) => {
        return edge.node.tasks.edges
          .map((edge) => {
            return edge.node.name
          })
          .sort()
      })
      expect(nodeNames).to.deep.equal([
        ['AAA', 'ABA', 'ABC', 'ABC', 'BAA', 'ZAA', 'ZAB', 'ZAC'],
        ['BBB', 'CAA', 'CCC', 'DDD'],
        [],
        [],
        [],
      ])
    })

    it('should support paging a nested connection', async function () {
      let result = await graphql(
        this.schema,
        `
        {
          user(id: ${this.userA.id}) {
            projects {
              edges {
                node {
                  tasks(first: 3, orderBy: LATEST) {
                    edges {
                      cursor
                      node {
                        id
                        name
                      }
                    }
                  }
                }
              }
            }
          }
        }
      `,
        null
      )

      if (result.errors) throw new Error(result.errors[0].stack)

      let projects = result.data.user.projects.edges.map(function (edge) {
        return edge.node
      })

      expect(projects[0].tasks.edges.length).to.equal(3)
      expect(projects[1].tasks.edges.length).to.equal(3)

      expect(projects[0].tasks.edges[0].node.id).to.equal(
        toGlobalId(this.Task.name, this.userA.tasks[4].get('id'))
      )
      expect(projects[1].tasks.edges[0].node.id).to.equal(
        toGlobalId(this.Task.name, this.userA.tasks[8].get('id'))
      )
    })

    it('should support connection fields', async function () {
      let result = await graphql(
        this.schema,
        `
        {
          user(id: ${this.userA.id}) {
            tasks {
              totalCount
            }
          }
        }
      `,
        null,
        {}
      )

      if (result.errors) throw new Error(result.errors[0].stack)

      expect(result.data.user.tasks.totalCount).to.equal(9)
      expect(
        this.userTaskConnectionFieldSpy.firstCall.args[0].source.get('tasks')
      ).to.be.undefined
    })

    it('should support connection fields on nested connections', async function () {
      let result = await graphql(
        this.schema,
        `
        {
          user(id: ${this.userA.id}) {
            projects {
              edges {
                node {
                  tasks {
                    totalCount
                  }
                }
              }
            }
          }
        }
      `,
        null,
        {}
      )

      if (result.errors) throw new Error(result.errors[0].stack)

      expect(result.data.user.projects.edges[0].node.tasks.totalCount).to.equal(
        8
      )
      expect(result.data.user.projects.edges[1].node.tasks.totalCount).to.equal(
        4
      )
      expect(
        this.projectTaskConnectionFieldSpy.firstCall.args[0].source.get('tasks')
      ).to.be.undefined
    })

    it('should support edgeFields', async function () {
      let result = await graphql(
        this.schema,
        `
        {
          user(id: ${this.userA.id}) {
            projects {
              edges {
                ...projectOwner
                node {
                  id
                }
              }
            }
          }
        }

        fragment projectOwner on userProjectEdge {
          isOwner
        }
      `,
        null
      )

      if (result.errors) throw new Error(result.errors[0].stack)

      let isOwner = result.data.user.projects.edges.map((edge) => edge.isOwner)
      expect(isOwner.sort()).to.deep.equal(
        [true, false, false, false, false].sort()
      )
    })

    it('should support connection fields with args/where', async function () {
      let result = await graphql(
        this.schema,
        `
        {
          user(id: ${this.userA.id}) {
            tasks(completed: true) {
              totalCount
            }
          }
        }
      `,
        null,
        {}
      )

      if (result.errors) throw new Error(result.errors[0].stack)

      expect(result.data.user.tasks.totalCount).to.equal(4)
      expect(
        this.userTaskConnectionFieldSpy.firstCall.args[0].source.get('tasks')
      ).to.be.undefined
    })

    it('should not barf on paging if there are no connection edges', async function () {
      let user = await this.User.create({})

      let result = await graphql(
        this.schema,
        `
        {
          user(id: ${user.get('id')}) {
            tasks(first: 10) {
              totalCount

              edges {
                node {
                  id
                }
              }

              pageInfo {
                hasNextPage
              }
            }
          }
        }
      `,
        null,
        {}
      )

      if (result.errors) throw new Error(result.errors[0].stack)
      expect(result.data.user).not.to.be.null
      expect(result.data.user.tasks.totalCount).to.equal(0)
      expect(result.data.user.tasks.pageInfo.hasNextPage).to.equal(false)
    })

    it('should support model connections', async function () {
      let viewer = await this.User.create()

      let tasks = await Promise.all([
        viewer.createTask({
          id: ++this.taskId,
        }),
        viewer.createTask({
          id: ++this.taskId,
        }),
        this.Task.create({
          id: ++this.taskId,
        }),
      ])

      let result = await graphql(
        this.schema,
        `
          {
            viewer {
              tasks {
                edges {
                  cursor
                  node {
                    id
                    name
                  }
                }
              }
            }
          }
        `,
        null,
        {
          viewer,
        }
      )

      expect(result.data.viewer.tasks.edges.length).to.equal(2)
      expect(
        result.data.viewer.tasks.edges
          .map((edge) => fromGlobalId(edge.node.id).id)
          .sort()
      ).deep.equal(
        tasks
          .slice(0, 2)
          .map((task) => task.get('id').toString())
          .sort()
      )
    })
  })
})
