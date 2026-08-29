# Browser bridge protocol v2

## Scope

Protocol v2 authenticates local MCP server and browser chart before chart
context, snapshots, or writes cross WebSocket. It does not encrypt frames.
Listener stays loopback-only. Remote deployments require authenticated TLS
gateway.

## Handshake

```text
browser -> server  bridge_hello(supportedVersions=[2], clientNonce)
server  -> browser bridge_challenge(protocolVersion=2, clientNonce,
                                    serverNonce, serverProof)
browser -> server  bridge_authenticate(protocolVersion=2, clientNonce,
                                       serverNonce, clientProof)
server  -> browser bridge_authenticated(protocolVersion=2)
browser -> server  ready(protocolVersion=2, chartId)
```

Both nonces are 32 random bytes encoded canonical unpadded base64url. Server
reserves client nonce five minutes in bounded 2,048-entry cache. Auth must
complete within five seconds.

Proofs use HMAC-SHA-256 with decoded 32-byte pairing token:

```text
romaco-mcp-bridge-auth-v2
role=<server|client>
client=<clientNonce>
server=<serverNonce>
```

Distinct roles block reflection. Browser verifies `serverProof` before sending
`clientProof`. Token never transmits.

## Interoperability vector

```text
token:       AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8
clientNonce: ICEiIyQlJicoKSorLC0uLzAxMjM0NTY3ODk6Ozw9Pj8
serverNonce: QEFCQ0RFRkdISUpLTE1OT1BRUlNUVVZXWFlaW1xdXl8
serverProof: qv9TzpCsC2Ki8IBDa811CQ56NiCeR76XL5khPpVOF38
clientProof: eSSyrGqO2-rl81b0t3lTw_clLjDM0roVvOuGZOZHH4A
```

## Failure codes

| Code | Meaning |
| --- | --- |
| `4400` | malformed/out-of-order message |
| `4401` | auth required/failed |
| `4403` | origin denied |
| `4406` | no common protocol version |
| `4408` | auth timeout |
| `4409` | replayed client nonce |

No chart socket adopts before authenticated `ready`. Responses resolve only
requests owned by same socket.

## Compatibility

`ROMACO_MCP_BRIDGE_AUTH=auto` chooses v2 with valid token. No token chooses
legacy v1 and logs warning. Configured malformed token fails closed. `required`
disables chart adapter when config missing/invalid; headless MCP remains.
`legacy` is explicit.

Server never accepts v1 and v2 on same listener, blocking downgrade after
failed v2 handshake.
