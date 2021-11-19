import { SupportedProvider, Web3ProviderEngine, Subprovider, Callback, ErrorCallback } from '@0x/subproviders';
import { providerUtils as ZeroExProviderUtils } from '@0x/utils';
import { assert } from '@0x/assert';
import { StatusCodes } from '@0x/types';
import http from 'http';
import https from 'https';
import { InternalError, MethodNotFound } from 'json-rpc-error';
import { JSONRPCRequestPayload } from 'ethereum-types';
import fetch, { Headers, Response } from 'node-fetch';

const httpAgent = new http.Agent({ keepAlive: true });
const httpsAgent = new https.Agent({ keepAlive: true });
const agent = (_parsedURL: any) => (_parsedURL.protocol === 'http:' ? httpAgent : httpsAgent);

/**
 * This class implements the [web3-provider-engine](https://github.com/MetaMask/provider-engine) subprovider interface.
 * It forwards on JSON RPC requests to the supplied `rpcUrl` endpoint
 */
class RPCSubProvider extends Subprovider {
  private readonly _rpcUrls: string[];
  private readonly _requestTimeoutMs: number;

  /**
   * @param rpcUrl URL to the backing Ethereum node to which JSON RPC requests should be sent
   * @param requestTimeoutMs Amount of miliseconds to wait before timing out the JSON RPC request
   */
  constructor(rpcUrl: string | string[], requestTimeoutMs: number = 5000) {
    super();

    this._rpcUrls = Array.isArray(rpcUrl) ? rpcUrl : [rpcUrl];
    this._rpcUrls.forEach((url) => assert.isString('rpcUrl', url));
    assert.isNumber('requestTimeoutMs', requestTimeoutMs);
    this._requestTimeoutMs = requestTimeoutMs;
  }

  /**
   * This method conforms to the web3-provider-engine interface.
   * It is called internally by the ProviderEngine when it is this subproviders
   * turn to handle a JSON RPC request.
   * @param payload JSON RPC payload
   * @param _next Callback to call if this subprovider decides not to handle the request
   * @param end Callback to call if subprovider handled the request and wants to pass back the request.
   */
  public async handleRequest(payload: JSONRPCRequestPayload, _next: Callback, end: ErrorCallback): Promise<void> {
    const finalPayload = Subprovider._createFinalPayload(payload);
    const headers = new Headers({
      Accept: 'application/json',
      'Accept-Encoding': 'gzip, deflate',
      Connection: 'keep-alive',
      'Content-Type': 'application/json',
    });

    let response: Response;
    const rpcUrl = this._rpcUrls[Math.floor(Math.random() * this._rpcUrls.length)];
    try {
      const cancelRequest = new AbortController()
      const abortTimer = setTimeout(() => cancelRequest.abort(), this._requestTimeoutMs);

      response = await fetch(rpcUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify(finalPayload),
        compress: true,
        signal: cancelRequest.signal,
        agent,
      });

      clearTimeout(abortTimer);
    } catch (err) {
      end(new InternalError(err));
      return;
    } finally {
    }

    const text = await response.text();
    if (!response.ok) {
      const statusCode = response.status;
      switch (statusCode) {
        case StatusCodes.MethodNotAllowed:
          end(new MethodNotFound());
          return;
        case StatusCodes.GatewayTimeout:
          const errMsg =
            'Gateway timeout. The request took too long to process. This can happen when querying logs over too wide a block range.';
          const err = new Error(errMsg);
          end(new InternalError(err));
          return;
        default:
          end(new InternalError(text));
          return;
      }
    }

    let data;
    try {
      data = JSON.parse(text);
    } catch (err) {
      end(new InternalError(err));
      return;
    }

    if (data.error) {
      end(data.error);
      return;
    }
    end(null, data.result);
  }
}

export function createWeb3Provider(rpcHost: string, timeout?: number): SupportedProvider {
  const providerEngine = new Web3ProviderEngine();
  providerEngine.addProvider(new RPCSubProvider(rpcHost, timeout));
  ZeroExProviderUtils.startProviderEngine(providerEngine);
  return providerEngine;
}
