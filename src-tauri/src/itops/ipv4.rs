// Pure IPv4 prefix math for IPAM (docs/ITOPS.md). No SQL, no Tauri, no
// dependencies: parsing, canonicalization, containment, and the utilization
// arithmetic the IPAM destination renders. The backend is authoritative here
// because AI/MCP callers can write prefixes; the frontend's subnet calculator
// stays a preview aid only.

/// A canonical IPv4 prefix: the network address (host bits already cleared)
/// plus the prefix length.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub struct Prefix {
    /// Network address as a big-endian u32 with host bits zeroed.
    pub network: u32,
    /// Prefix length, 0..=32.
    pub length: u8,
}

pub fn parse_address(text: &str) -> Option<u32> {
    let text = text.trim();
    let mut octets = [0u32; 4];
    let mut count = 0usize;
    for part in text.split('.') {
        if count == 4 || part.is_empty() || part.len() > 3 {
            return None;
        }
        if !part.bytes().all(|byte| byte.is_ascii_digit()) {
            return None;
        }
        let value: u32 = part.parse().ok()?;
        if value > 255 {
            return None;
        }
        octets[count] = value;
        count += 1;
    }
    if count != 4 {
        return None;
    }
    Some((octets[0] << 24) | (octets[1] << 16) | (octets[2] << 8) | octets[3])
}

pub fn format_address(value: u32) -> String {
    format!(
        "{}.{}.{}.{}",
        (value >> 24) & 0xff,
        (value >> 16) & 0xff,
        (value >> 8) & 0xff,
        value & 0xff
    )
}

/// The netmask for `length`, guarding the u32 shift overflow at /0.
pub fn netmask(length: u8) -> u32 {
    if length == 0 {
        0
    } else {
        u32::MAX << (32 - length.min(32))
    }
}

impl Prefix {
    /// Parses `a.b.c.d/len`, clearing host bits so two spellings of the same
    /// network ("10.0.0.5/24" and "10.0.0.0/24") canonicalize identically.
    pub fn parse(text: &str) -> Option<Self> {
        let text = text.trim();
        let (address, length) = text.split_once('/')?;
        let length: u8 = length.trim().parse().ok()?;
        if length > 32 {
            return None;
        }
        let address = parse_address(address)?;
        Some(Self {
            network: address & netmask(length),
            length,
        })
    }

    /// Canonical `a.b.c.d/len` text — what gets stored so lookups can compare
    /// strings without re-parsing.
    pub fn to_cidr(self) -> String {
        format!("{}/{}", format_address(self.network), self.length)
    }

    /// Last address in the prefix (the broadcast address for /0../30).
    pub fn last(self) -> u32 {
        self.network | !netmask(self.length)
    }

    /// Total addresses in the prefix, including network and broadcast.
    pub fn size(self) -> u64 {
        1u64 << (32 - self.length.min(32))
    }

    /// Assignable addresses. /31 (RFC 3021 point-to-point) and /32 (single
    /// host) have no network/broadcast pair to subtract.
    pub fn usable(self) -> u64 {
        if self.length >= 31 {
            self.size()
        } else {
            self.size() - 2
        }
    }

    pub fn contains_address(self, address: u32) -> bool {
        address & netmask(self.length) == self.network
    }

    /// True when `other` is inside `self` (a prefix contains itself).
    pub fn contains_prefix(self, other: Self) -> bool {
        other.length >= self.length && self.contains_address(other.network)
    }
}

/// Index of the innermost prefix in `prefixes` that contains `child`, ignoring
/// `child` itself. Returns `None` for a top-level prefix.
pub fn parent_index(prefixes: &[Prefix], child_index: usize) -> Option<usize> {
    let child = prefixes[child_index];
    let mut best: Option<usize> = None;
    for (index, candidate) in prefixes.iter().enumerate() {
        if index == child_index || !candidate.contains_prefix(child) {
            continue;
        }
        // Equal-length duplicates would contain each other; only a strictly
        // shorter prefix can be a parent.
        if candidate.length >= child.length {
            continue;
        }
        if best.is_none_or(|current| prefixes[current].length < candidate.length) {
            best = Some(index);
        }
    }
    best
}

/// Total address count covered by `children`, treating them as already
/// non-overlapping siblings. Callers pass direct children only, so nested
/// grandchildren are not double-counted.
pub fn covered_size(children: &[Prefix]) -> u64 {
    children.iter().map(|child| child.size()).sum()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_and_canonicalizes_prefixes() {
        let prefix = Prefix::parse("10.0.0.5/24").unwrap();
        assert_eq!(prefix.to_cidr(), "10.0.0.0/24");
        assert_eq!(Prefix::parse(" 192.168.1.0/24 ").unwrap().length, 24);
        assert_eq!(Prefix::parse("0.0.0.0/0").unwrap().to_cidr(), "0.0.0.0/0");
    }

    #[test]
    fn rejects_malformed_input() {
        for text in [
            "10.0.0.0",
            "10.0.0.0/33",
            "10.0.0.256/24",
            "10.0.0/24",
            "10.0.0.0.1/24",
            "ten.0.0.0/8",
            "10.0.0.0/",
            "",
            "10.0.0.0/-1",
        ] {
            assert!(Prefix::parse(text).is_none(), "expected {text} to be invalid");
        }
    }

    #[test]
    fn computes_sizes_including_rfc3021_edges() {
        assert_eq!(Prefix::parse("10.0.0.0/24").unwrap().usable(), 254);
        assert_eq!(Prefix::parse("10.0.0.0/31").unwrap().usable(), 2);
        assert_eq!(Prefix::parse("10.0.0.1/32").unwrap().usable(), 1);
        assert_eq!(Prefix::parse("0.0.0.0/0").unwrap().size(), 1 << 32);
        assert_eq!(
            Prefix::parse("10.0.0.0/24").unwrap().last(),
            parse_address("10.0.0.255").unwrap()
        );
    }

    #[test]
    fn resolves_the_innermost_parent() {
        let prefixes = [
            Prefix::parse("10.0.0.0/8").unwrap(),
            Prefix::parse("10.1.0.0/16").unwrap(),
            Prefix::parse("10.1.2.0/24").unwrap(),
            Prefix::parse("192.168.0.0/16").unwrap(),
        ];
        assert_eq!(parent_index(&prefixes, 0), None);
        assert_eq!(parent_index(&prefixes, 1), Some(0));
        assert_eq!(parent_index(&prefixes, 2), Some(1));
        assert_eq!(parent_index(&prefixes, 3), None);
    }

    #[test]
    fn containment_matches_address_membership() {
        let prefix = Prefix::parse("10.1.2.0/24").unwrap();
        assert!(prefix.contains_address(parse_address("10.1.2.1").unwrap()));
        assert!(!prefix.contains_address(parse_address("10.1.3.1").unwrap()));
        assert!(prefix.contains_prefix(prefix));
        assert!(!Prefix::parse("10.1.2.0/25")
            .unwrap()
            .contains_prefix(prefix));
    }

    #[test]
    fn sums_child_coverage() {
        let children = [
            Prefix::parse("10.1.0.0/25").unwrap(),
            Prefix::parse("10.1.0.128/25").unwrap(),
        ];
        assert_eq!(covered_size(&children), 256);
    }
}
