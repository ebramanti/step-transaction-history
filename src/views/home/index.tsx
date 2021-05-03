import {
  Connection,
  ParsedConfirmedTransaction,
  PublicKey,
  TransactionSignature,
} from "@solana/web3.js";
import { Button, Col, Row } from "antd";
import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ConnectButton } from "../../components/ConnectButton";
import { TokenIcon } from "../../components/TokenIcon";
import { useConnection, useConnectionConfig } from "../../contexts/connection";
import { useMarkets } from "../../contexts/market";
import { useWallet } from "../../contexts/wallet";
import { useUserBalance, useUserTotalBalance } from "../../hooks";
import { WRAPPED_SOL_MINT } from "../../utils/ids";
import { formatUSD } from "../../utils/utils";

const SERUM_SWAP_PROGRAM_ID = "SwaPpA9LAaLfeLi3a68M4DjnLqgtticKg6CnyNwgAC8";
const ORCA_SWAP_PROGRAM_ID = "DjVE6JNiYqPL2QXyCUUh8rNjHrbz9hXHNYt99MQ59qw1";
const PROGRAM_ID_SET = new Set([SERUM_SWAP_PROGRAM_ID, ORCA_SWAP_PROGRAM_ID]);

type TransactionFilterOptions = {
  before?: TransactionSignature;
  limit?: number;
  programIds?: Set<string>;
};

const getFilteredTransactions = async (
  connection: Connection,
  publicKey: PublicKey,
  options: TransactionFilterOptions = {}
): Promise<ParsedConfirmedTransaction[]> => {
  let filteredTransactions: ParsedConfirmedTransaction[] = [];
  const limit = options.limit || 20;
  let before = options?.before;
  while (filteredTransactions.length < limit) {
    const confirmedSignatures = await connection.getConfirmedSignaturesForAddress2(
      publicKey,
      {
        before: before,
        limit: 50,
      },
      "confirmed"
    );
    const rawSignatures = confirmedSignatures.map(({ signature }) => signature);
    const confirmedTransactions = await connection.getParsedConfirmedTransactions(
      rawSignatures,
      "confirmed"
    );
    const currentFilteredTransactions = confirmedTransactions.filter(
      (data): data is ParsedConfirmedTransaction => {
        if (!data) {
          return false;
        }

        if (options?.programIds) {
          return data.transaction.message.instructions.some((i) =>
            options.programIds!.has(i.programId.toBase58())
          );
        }

        return true;
      }
    );
    filteredTransactions = filteredTransactions.concat(
      currentFilteredTransactions
    );
    before =
      filteredTransactions[filteredTransactions.length - 1].transaction
        .signatures[0];
  }
  return filteredTransactions.slice(0, limit);
};

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
