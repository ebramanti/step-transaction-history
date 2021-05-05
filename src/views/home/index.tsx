import { ParsedConfirmedTransaction, PublicKey } from "@solana/web3.js";
import { Button, Col, Row } from "antd";
import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ConnectButton } from "../../components/ConnectButton";
import { TokenIcon } from "../../components/TokenIcon";
import {
  cache,
  getMultipleAccounts,
  TokenAccountParser,
} from "../../contexts/accounts";
import { useConnection, useConnectionConfig } from "../../contexts/connection";
import { useMarkets } from "../../contexts/market";
import { useWallet } from "../../contexts/wallet";
import { useUserBalance, useUserTotalBalance } from "../../hooks";
import {
  getFilteredTransactions,
  getOrcaData,
  getSerumData,
  ORCA_SWAP_PROGRAM_ID,
  PROGRAM_ID_SET,
  SERUM_SWAP_PROGRAM_ID,
} from "../../transactionHistory";
import { WRAPPED_SOL_MINT } from "../../utils/ids";
import { formatUSD } from "../../utils/utils";

export const HomeView = () => {
  const { wallet } = useWallet();
  const publicKey = wallet?.publicKey;
  const connection = useConnection();
  const { marketEmitter, midPriceInUSD } = useMarkets();
  const { tokenMap } = useConnectionConfig();
  const SRM_ADDRESS = "SRMuApVNdxXokk5GT7XD5cUUgXMBCoAz2LHeuAoKWRt";
  const STEP_ADDRESS = "StepAscQoEioFxxWGnh2sLBDFp9d8rvKz2Yp39iDpyT";
  const SRM = useUserBalance(SRM_ADDRESS);
  const STEP = useUserBalance(STEP_ADDRESS);
  const SOL = useUserBalance(WRAPPED_SOL_MINT);
  const { balanceInUSD: totalBalanceInUSD } = useUserTotalBalance();
  const [transactions, setTransactions] = useState<
    ParsedConfirmedTransaction[]
  >([]);

  useEffect(() => {
    const refreshTotal = () => {};

    const dispose = marketEmitter.onMarket(() => {
      refreshTotal();
    });

    refreshTotal();

    return () => {
      dispose();
    };
  }, [marketEmitter, midPriceInUSD, tokenMap]);

  useEffect(() => {
    if (publicKey) {
      getFilteredTransactions(connection, publicKey, {
        programIds: PROGRAM_ID_SET,
      }).then((filteredTransactions) => {
        setTransactions(filteredTransactions);
        console.log(filteredTransactions);
        const serumTransaction = filteredTransactions.find((data) => {
          return data.transaction.message.instructions.some(
            (i) => i.programId.toBase58() === SERUM_SWAP_PROGRAM_ID
          );
        });
        const orcaTransaction = filteredTransactions.find((data) => {
          return data.transaction.message.instructions.some(
            (i) => i.programId.toBase58() === ORCA_SWAP_PROGRAM_ID
          );
        });
        console.log(serumTransaction);
        const serumData = getSerumData(serumTransaction!);
        console.log(serumData);
        const orcaData = getOrcaData(orcaTransaction!);
        console.log(orcaData);

        // Example implementation of how to load token data from source addresses in swap
        getMultipleAccounts(
          connection,
          [
            serumData.fromSource,
            serumData.toSource,
            orcaData.fromSource,
            orcaData.toSource,
          ],
          "confirmed"
        ).then((accounts) => {
          accounts.keys.forEach((key, index) => {
            const account = accounts.array[index];
            if (account) {
              cache.add(new PublicKey(key), account, TokenAccountParser);
            }
          });
        });
      });

      // TODO: Remove, using this to manually test before argument
      // @ts-ignore
      window.getFilteredTransactions = (before: string) =>
        getFilteredTransactions(connection, publicKey, {
          before: before,
          programIds: PROGRAM_ID_SET,
        });
    }
  }, [publicKey, connection]);

  return (
    <Row gutter={[16, 16]} align="middle">
      <Col span={24}>
        <h2>Your balances ({formatUSD.format(totalBalanceInUSD)}):</h2>
        <h2>
          SOL: {SOL.balance} ({formatUSD.format(SOL.balanceInUSD)})
        </h2>
        <h2 style={{ display: "inline-flex", alignItems: "center" }}>
          <TokenIcon mintAddress={SRM_ADDRESS} /> SRM: {SRM.balance} (
          {formatUSD.format(SRM?.balanceInUSD)})
        </h2>
        <br />
        <h2 style={{ display: "inline-flex", alignItems: "center" }}>
          <TokenIcon mintAddress={STEP_ADDRESS} /> STEP: {STEP.balance} (
          {formatUSD.format(SRM?.balanceInUSD)})
        </h2>
      </Col>

      <Col span={12}>
        <ConnectButton />
      </Col>
      <Col span={12}>
        <Link to="/faucet">
          <Button>Faucet</Button>
        </Link>
      </Col>
      <Col span={24}>
        <div className="builton" />
      </Col>
    </Row>
  );
};
