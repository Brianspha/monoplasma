const MonoplasmaMember = require("./monoplasmaMember")
const MerkleTree = require("./merkletree")
const BN = require("bn.js")
const SortedMap = require("collections/sorted-map")

/**
 * Monoplasma state object
 *
 * Contains the logic of revenue distribution as well as current balances of/and participants
 */
class Monoplasma {
    /**
     * @param {Array} initialMembers objects: [ { address, earnings }, { address, earnings }, ... ]
     */
    constructor(initialMembers, store) {
        this.store = store
        // SortedMap constructor wants [[key1, value1], [key2, value2], ...]
        /** @property {Map<MonoplasmaMember>} members */
        this.members = new SortedMap(Array.isArray(initialMembers) ?
            initialMembers.map(m => [m.address, new MonoplasmaMember(undefined, m.address, m.earnings)]) : [])
        /** @property {MerkleTree} tree The MerkleTree for calculating the hashes */
        this.tree = new MerkleTree(this.members)
    }

    // ///////////////////////////////////
    //      MEMBER API
    // ///////////////////////////////////

    getMembers() {
        return this.members
            .filter(m => m.isActive())
            .map(m => m.toObject())
    }

    getMemberCount() {
        const total = this.members.size
        const active = this.members.filter(m => m.isActive()).size
        return {
            total,
            active,
            inactive: total - active,
        }
    }

    getMember(address) {
        const m = this.members.get(address)
        if (!m) { return {} }
        const obj = m.toObject()
        obj.active = m.isActive()
        obj.proof = m.getProof(this.tree)
        return obj
    }

    /**
     * Get proof of earnings for withdrawal ("payslip")
     * @param address with earnings to be verified
     * @returns {Array} of bytes32 hashes ["0x123...", "0xabc..."]
     */
    getProof(address) {
        const path = this.tree.getPath(address)
        return path
    }

    getRootHash() {
        return this.tree.getRootHash()
    }

    // ///////////////////////////////////
    //      ADMIN API
    // ///////////////////////////////////

    /**
     * @param {number} amount of tokens that was added to the Community revenues
     */
    addRevenue(amount) {
        const activeMembers = this.members.filter(m => m.isActive())
        const activeCount = new BN(activeMembers.length)
        if (activeCount === 0) {
            console.error("No active members in community!")
            return
        }

        const share = new BN(amount).divRound(activeCount)
        activeMembers.forEach(m => m.addRevenue(share))
        this.tree.update(this.members)
    }

    /**
     * Add an active recipient into Community, or re-activate existing one (previously removed)
     * @param {string} address of the new member
     * @param {string} name of the new member
     * @returns {boolean} if the added member was new (previously unseen)
     */
    addMember(address, name) {
        const m = this.members.get(address)
        if (m) {
            m.setActive(true)
        } else {
            this.members.set(address, new MonoplasmaMember(name, address))
        }
        // tree.update(members)     // no need for update since no revenue allocated
        return !!m
    }

    /**
     * De-activate a member, it will not receive revenues until re-activated
     * @param {string} address
     * @returns {boolean} if the de-activated member was previously active (and existing)
     */
    removeMember(address) {
        const m = this.members.get(address)
        const wasActive = m && m.isActive()
        if (wasActive) {
            m.setActive(false)
        }
        // tree.update(members)     // no need for update since no revenue allocated
        return wasActive
    }

    /**
     * Monoplasma member to be added
     * @typedef {Object<string, string>} IncomingMember
     * @property {string} address Ethereum address of the Community member
     * @property {string} name Human-readable string representation
     */
    /**
     * Add active recipients into Community, or re-activate existing ones (previously removed)
     * @param {Array<IncomingMember>} members
     */
    addMembers(members) {
        let added = 0
        members.forEach(member => {
            const wasNew = this.addMember(member.address, member.name)
            added += wasNew ? 1 : 0
        })
        return added
    }

    /**
     * De-activate members: they will not receive revenues until re-activated
     * @param {Array<string>} addresses
     */
    removeMembers(addresses) {
        let removed = 0
        addresses.forEach(address => {
            const wasActive = this.removeMember(address)
            removed += wasActive ? 1 : 0
        })
        return removed
    }

    /**
     * Stash the merkle tree state for later use
     * @param {number} rootChainBlocknumber
     */
    storeBlock(rootChainBlocknumber) {
        this.store.saveBlock(this.members.toArray(), rootChainBlocknumber)
    }

    /**
     * Return a read-only "member API" that can only query this object
     */
    getMemberApi() {
        return {
            getMembers: this.getMembers.bind(this),
            getMember: this.getMember.bind(this),
            getProof: this.getProof.bind(this),
            getRootHash: this.getRootHash.bind(this),
        }
    }
}

module.exports = Monoplasma
