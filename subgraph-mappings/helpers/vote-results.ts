import { Address, log, Bytes } from "@graphprotocol/graph-ts";

import { OffchainVotingContract } from "../../generated/templates/DaoRegistry/OffchainVotingContract";
import { VotingContract } from "../../generated/templates/DaoRegistry/VotingContract";
import { IVoting } from "../../generated/templates/DaoRegistry/IVoting";

import { Adapter, Proposal, Vote } from "../../generated/schema";

import { VOTING_ID } from "./constants";

export function loadProposalAndSaveVoteResults(
  daoAddress: Address,
  proposalId: Bytes
): Proposal | null {
  // load the existing proposal
  let maybeProposalId = daoAddress
    .toHex()
    .concat("-proposal-")
    .concat(proposalId.toHex());
  let proposal = Proposal.load(maybeProposalId);

  let voteId = daoAddress.toHex().concat("-vote-").concat(proposalId.toHex());
  let vote = new Vote(voteId);

  // load the voting adapter data
  let votingAdapterId = daoAddress
    .toHex()
    .concat("-adapter-")
    .concat(VOTING_ID);

  let votingAdapter = Adapter.load(votingAdapterId);

  if (votingAdapter) {
    let votingIContract = IVoting.bind(
      Address.fromString(votingAdapter.adapterAddress.toHex())
    );
    let votingAdapterName = votingIContract.getAdapterName();

    if (votingAdapterName == "VotingContract") {
      let votingContract = VotingContract.bind(
        Address.fromHexString(
          votingAdapter.adapterAddress.toHexString()
        ) as Address
      );
      // get vote results
      let voteResults = votingContract.votes(daoAddress, proposalId);

      // assign voting data
      vote.nbYes = voteResults.value0;
      vote.nbNo = voteResults.value1;

      vote.adapterName = votingAdapterName;
      vote.adapterAddress = votingAdapter.adapterAddress;

      vote.save();

      if (proposal) {
        proposal.nbYes = voteResults.value0;
        proposal.nbNo = voteResults.value1;
        proposal.startingTime = voteResults.value2;
        proposal.blockNumber = voteResults.value3;
      }
    } else if (votingAdapterName == "OffchainVotingContract") {
      let offchainVotingContract = OffchainVotingContract.bind(
        Address.fromHexString(
          votingAdapter.adapterAddress.toHexString()
        ) as Address
      );
      // get vote results
      let voteResults = offchainVotingContract.votes(daoAddress, proposalId);

      // assign voting data
      vote.nbVoters = voteResults.value4;
      vote.nbYes = voteResults.value5;
      vote.nbNo = voteResults.value6;

      vote.adapterName = votingAdapterName;
      vote.adapterAddress = votingAdapter.adapterAddress;

      vote.save();

      if (proposal) {
        proposal.snapshot = voteResults.value0;
        proposal.proposalHash = voteResults.value1;
        proposal.reporter = voteResults.value2;
        proposal.resultRoot = voteResults.value3;

        proposal.nbVoters = voteResults.value4;
        proposal.nbYes = voteResults.value5;
        proposal.nbNo = voteResults.value6;
        proposal.index = voteResults.value7;

        proposal.startingTime = voteResults.value8;
        proposal.gracePeriodStartingTime = voteResults.value9;
        proposal.isChallenged = voteResults.value10;
        proposal.fallbackVotesCount = voteResults.value11;
      }
    }
  }

  return proposal;
}
