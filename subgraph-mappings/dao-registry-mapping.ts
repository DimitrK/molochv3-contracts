import { log, store } from "@graphprotocol/graph-ts";
import {
  ProcessedProposal,
  SponsoredProposal,
  SubmittedProposal,
  UpdateDelegateKey,
  AdapterAdded,
  AdapterRemoved,
  ExtensionAdded,
  ExtensionRemoved,
  ConfigurationUpdated,
  AddressConfigurationUpdated,
  DaoRegistry,
} from "../generated/templates/DaoRegistry/DaoRegistry";
import {
  Adapter,
  Extension,
  Proposal,
  Member,
  TributeDao,
} from "../generated/schema";
import { BANK_EXTENSION_ID } from "./helpers/constants";
import { getProposalDetails } from "./helpers/proposal-details";
import { loadProposalAndSaveVoteResults } from "./helpers/vote-results";

export function handleSubmittedProposal(event: SubmittedProposal): void {
  let submittedBy = event.transaction.from;
  let proposalId = event.params.proposalId;
  let daoAddress = event.address;
  let daoProposalId = daoAddress
    .toHex()
    .concat("-proposal-")
    .concat(proposalId.toHex());

  let proposal = Proposal.load(daoProposalId);

  log.info(
    "=============== SubmittedProposal event fired. daoAddress: {}, proposalId: {}",
    [event.address.toHexString(), event.params.proposalId.toHexString()]
  );

  let daoRegistry = DaoRegistry.bind(event.address);
  let data = daoRegistry.proposals(event.params.proposalId);

  log.info("INFO proposals , {}, {}", [
    data.value0.toHexString(), // `adapterAddress`
    data.value1.toString(), // `flags`
  ]);

  let adapterAdddress = data.value0;

  let inverseAdapter = daoRegistry.inverseAdapters(adapterAdddress);

  log.info("INFO inverseAdapter , {}, {}", [
    inverseAdapter.value0.toHexString(), // adapterId
    inverseAdapter.value1.toString(), // acl
  ]);

  if (proposal == null) {
    proposal = new Proposal(daoProposalId);

    proposal.adapterId = inverseAdapter.value0;
    proposal.flags = event.params.flags;
    proposal.submittedBy = submittedBy;
    proposal.proposalId = proposalId;
    proposal.sponsored = false;
    proposal.processed = false;
    proposal.member = submittedBy.toHex();

    proposal.save();
  }

  getProposalDetails(
    inverseAdapter.value0,
    adapterAdddress,
    daoAddress,
    proposalId
  );
}

export function handleSponsoredProposal(event: SponsoredProposal): void {
  let id = event.params.proposalId;
  let daoAddress = event.address.toHex(); // dao contract address
  let newProposalId = daoAddress.concat("-proposal-").concat(id.toHex());

  let proposal = Proposal.load(newProposalId);
  let sponsoredAt = event.block.timestamp.toString();

  log.info("=============== SponsoredProposal event fired. proposalId: {}", [
    event.params.proposalId.toHexString(),
  ]);

  proposal.flags = event.params.flags;
  proposal.sponsoredAt = sponsoredAt;
  proposal.sponsored = true;
  proposal.sponsoredBy = event.transaction.from;
  proposal.votingAdapter = event.params.votingAdapter;

  proposal.save();
}

export function handleProcessedProposal(event: ProcessedProposal): void {
  let processedAt = event.block.timestamp.toString();

  log.info("=============== ProcessedProposal event fired. proposalId: {}", [
    event.params.proposalId.toHexString(),
  ]);

  let proposal = loadProposalAndSaveVoteResults(
    event.address,
    event.params.proposalId
  );

  if (proposal) {
    proposal.flags = event.params.flags;
    proposal.processedAt = processedAt;
    proposal.processed = true;
    proposal.processedBy = event.transaction.from;

    proposal.save();
  }
}

export function handleUpdateDelegateKey(event: UpdateDelegateKey): void {
  let daoAddress = event.address.toHexString();
  let delegateKey = event.params.newDelegateKey;
  let memberId = daoAddress
    .concat("-member-")
    .concat(event.params.memberAddress.toHex());

  let member = Member.load(memberId);
  member.delegateKey = delegateKey;
  member.isDelegated =
    event.params.memberAddress != event.params.newDelegateKey;

  log.info(
    "=============== UpdateDelegateKey event fired. memberAddress {}, newDelegateKey {}",
    [
      event.params.memberAddress.toHexString(),
      event.params.newDelegateKey.toHexString(),
    ]
  );

  member.save();
}

export function handleAdapterAdded(event: AdapterAdded): void {
  let daoAddress = event.address.toHexString();
  let adapterId = event.params.adapterId;
  let daoAdapterId = daoAddress.concat("-adapter-").concat(adapterId.toHex());

  let adapter = Adapter.load(daoAdapterId);

  log.info("=============== AdapterAdded event fired. adapterId: {}", [
    event.params.adapterId.toHexString(),
  ]);

  if (adapter == null) {
    adapter = new Adapter(daoAdapterId);
    adapter.adapterId = event.params.adapterId;
    adapter.acl = event.params.flags;
    adapter.adapterAddress = event.params.adapterAddress;

    // create 1-1 relationship with adapter and its dao
    adapter.tributedao = daoAddress;

    adapter.save();
  }
}

export function handleAdapterRemoved(event: AdapterRemoved): void {
  let daoAddress = event.address.toHexString();
  let adapterId = event.params.adapterId;
  let daoAdapterId = daoAddress.concat("-adapter-").concat(adapterId.toHex());

  let adapter = Adapter.load(daoAdapterId);

  log.info("=============== AdapterRemoved event fired. adapterId: {}", [
    event.params.adapterId.toHexString(),
  ]);

  if (adapter != null) {
    store.remove("Adapter", daoAdapterId);
  }
}

export function handleExtensionAdded(event: ExtensionAdded): void {
  let daoAddress = event.address.toHexString();
  let extensionId = event.params.extensionId;

  let daoExtensionId = daoAddress
    .concat("-extension-")
    .concat(extensionId.toHex());

  log.info(
    "=============== ExtensionAdded event fired. extensionAddress {}, extensionId {}, daoAddress {}",
    [
      event.params.extensionAddress.toHexString(),
      event.params.extensionId.toHexString(),
      daoAddress,
    ]
  );

  let extension = Extension.load(daoExtensionId);

  // if extension is `bank` then assign to its dao
  if (BANK_EXTENSION_ID.toString() == event.params.extensionId.toHexString()) {
    let tribute = TributeDao.load(daoAddress);

    tribute.bankAddress = event.params.extensionAddress;
    tribute.save();
  }

  if (extension == null) {
    extension = new Extension(daoExtensionId);
  }

  extension.extensionAddress = event.params.extensionAddress;
  extension.extensionId = event.params.extensionId;

  // create 1-1 relationship with extensions and its dao
  extension.tributedao = daoAddress;
  extension.save();
}

export function handleExtensionRemoved(event: ExtensionRemoved): void {
  let daoAddress = event.address.toHexString();
  let extensionId = event.params.extensionId;
  let daoExtensionId = daoAddress
    .concat("-extension-")
    .concat(extensionId.toHex());

  log.info("=============== ExtensionRemoved event fired. extensionId {}", [
    event.params.extensionId.toHexString(),
  ]);
  let extension = Extension.load(daoExtensionId);

  if (extension != null) {
    store.remove("Extension", daoExtensionId);
  }
}

export function handleConfigurationUpdated(event: ConfigurationUpdated): void {
  log.info(
    "=============== ConfigurationUpdated event fired. key {}, value {}",
    [event.params.key.toHexString(), event.params.value.toHexString()]
  );
}

export function handleAddressConfigurationUpdated(
  event: AddressConfigurationUpdated
): void {
  log.info(
    "=============== AddressConfigurationUpdated event fired. key {}, value {}",
    [event.params.key.toHexString(), event.params.value.toHexString()]
  );
}
