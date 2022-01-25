import { describe, it } from 'mocha'
import { makeExecutableSchema } from 'graphql-tools'
import { graphql } from 'graphql'
import getSelection from '../../src/getSelection'

import { expect } from 'chai'

describe(`getSelection`, function () {
  it(`works`, async function () {
    let selection = null

    const schema = makeExecutableSchema({
      typeDefs: `
      type ConnectionChannel {
        externalId: String!
        internalTag: String!
      }
      type ConnectionChannelEdge {
        node: ConnectionChannel
        cursor: String!
      }
      type PageInfo {
        hasPreviousPage: Boolean!
        hasNextPage: Boolean!
        startCursor: String
        endCursor: String
      }
      type ConnectionChannelPage {
        pageInfo: PageInfo!
        edges: [ConnectionChannelEdge]
      }
      type Query {
        ConnectionChannelPage(
          selection: [String!]
        ): ConnectionChannelPage
      }
    `,
      resolvers: {
        Query: {
          ConnectionChannelPage: async (
            src,
            args,
            context,
            info
          ) => {
            const { fieldNodes, fieldName, fragments } = info
            const node = fieldNodes.find((n) => n.name && n.name.value === fieldName)
            selection =
              args.selection && node
                ? getSelection({ node, selection: args.selection, fragments })
                : null
          },
        },
      },
    })

    async function selectionFor(
      requestString
    ) {
      const result = await graphql({schema, source: requestString})
      if (result.errors) throw new Error(JSON.stringify(result.errors))
      return selection
    }

    const expectSelectionFor = (requestString) =>
      expect(selectionFor(requestString), `selection for ${requestString}`)

    await expectSelectionFor(`{
      ConnectionChannelPage(
        selection: ["pageInfo", "hasNextPage"]
      ) {
        pageInfo {
          hasNextPage
        }
      }
    }`).to.eventually.exist

    await expectSelectionFor(`{
      ConnectionChannelPage(
        selection: ["pageInfo", "hasNextPage"]
      ) {
        pageInfo {
          ... on PageInfo {
            hasNextPage
          }
        }
      }
    }`).to.eventually.exist

    await expectSelectionFor(`
      fragment B on PageInfo {
        hasNextPage
        ... on PageInfo {
          startCursor
        }
      }

      fragment A on ConnectionChannelPage {
        pageInfo {
          ...B
        }
      }
      query {
        ConnectionChannelPage(
          selection: ["pageInfo", "hasNextPage"]
        ) {
          ...A
        }
      }
    `).to.eventually.exist

    await expectSelectionFor(`
      fragment B on PageInfo {
        hasNextPage
        ... on PageInfo {
          startCursor
        }
      }

      fragment A on ConnectionChannelPage {
        pageInfo {
          ...B
        }
      }
      query {
        ConnectionChannelPage(
          selection: ["pageInfo", "startCursor"]
        ) {
          ...A
        }
      }
    `).to.eventually.exist

    await expectSelectionFor(`
      fragment B on PageInfo {
        hasNextPage
        ... on PageInfo {
          startCursor
        }
      }

      fragment A on ConnectionChannelPage {
        pageInfo {
          ...B
        }
      }
      query {
        ConnectionChannelPage(
          selection: ["pageInfo", "endCursor"]
        ) {
          ...A
        }
      }
    `).to.eventually.not.exist

    await expectSelectionFor(`{
      ConnectionChannelPage(
        selection: ["pageInfo", "hasPreviousPage"]
      ) {
        pageInfo {
          hasNextPage
        }
      }
    }`).to.eventually.not.exist

    await expectSelectionFor(`{
      ConnectionChannelPage(
        selection: ["pageInfo", "hasPreviousPage"]
      ) {
        pageInfo {
          ... on PageInfo {
            hasNextPage
          }
        }
      }
    }`).to.eventually.not.exist

    await expectSelectionFor(`{
      ConnectionChannelPage(
        selection: ["pageInfo", "hasPreviousPage"]
      ) {
        edges {
          cursor
        }
      }
    }`).to.eventually.not.exist

    await expectSelectionFor(`{
      ConnectionChannelPage(
        selection: ["edges", "cursor"]
      ) {
        edges {
          cursor
        }
      }
    }`).to.eventually.exist
  })
})
