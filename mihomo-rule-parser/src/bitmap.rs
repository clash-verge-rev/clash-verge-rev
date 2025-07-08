pub(crate) struct Bitmap;

// 全局静态常量
static SELECT_8_LOOKUP: [u8; 256 * 8] = generate_select8_lookup();
static MASK: [u64; 65] = generate_mask();
static RMASK: [u64; 65] = generate_rmask();
static MASK_UPTO: [u64; 64] = generate_mask_upto();
static RMASK_UPTO: [u64; 64] = generate_rmask_upto();
static BIT: [u64; 64] = generate_bit();

const fn generate_select8_lookup() -> [u8; 256 * 8] {
    let mut arr = [0u8; 256 * 8];
    let mut i = 0;
    while i < 256 {
        let mut w = i as u8;
        let mut j = 0;
        while j < 8 {
            let x = w.trailing_zeros() as u8;
            if w != 0 {
                w &= w - 1;
            }
            arr[i * 8 + j] = x;
            j += 1;
        }
        i += 1;
    }
    arr
}

const fn generate_mask() -> [u64; 65] {
    let mut arr = [0u64; 65];
    let mut i = 0;
    while i < 65 {
        arr[i] = if i < 64 { (1 << i) - 1 } else { u64::MAX };
        i += 1;
    }
    arr
}

const fn generate_rmask() -> [u64; 65] {
    let mut arr = [0u64; 65];
    let mut i = 0;
    while i < 65 {
        arr[i] = !generate_mask()[i];
        i += 1;
    }
    arr
}

const fn generate_mask_upto() -> [u64; 64] {
    let mut arr = [0u64; 64];
    let mut i = 0;
    while i < 64 {
        let bits = i + 1;
        arr[i] = if bits < 64 { (1 << bits) - 1 } else { u64::MAX };
        i += 1;
    }
    arr
}

const fn generate_rmask_upto() -> [u64; 64] {
    let mut arr = [0u64; 64];
    let mut i = 0;
    while i < 64 {
        arr[i] = !generate_mask_upto()[i];
        i += 1;
    }
    arr
}

const fn generate_bit() -> [u64; 64] {
    let mut arr = [0u64; 64];
    let mut i = 0;
    while i < 64 {
        arr[i] = 1 << i;
        i += 1;
    }
    arr
}

impl Bitmap {
    pub fn index_select_32_r64(words: &[u64]) -> (Vec<i32>, Vec<i32>) {
        let l = words.len() << 6;
        let mut sidx = Vec::<i32>::new();

        let mut ith = -1;
        for i in 0..l {
            if (words[i >> 6] & (1 << (i & 63))) != 0 {
                ith += 1;
                if ith & 31 == 0 {
                    sidx.push(i as i32);
                }
            }
        }
        (sidx, Self::index_rank64(words, true))
    }

    /// An optional bool specifies whether to add a last index entry of count of all
    pub fn index_rank64(words: &[u64], trailing: bool) -> Vec<i32> {
        let mut length = words.len();
        if trailing {
            length += 1;
        }
        let mut idx = Vec::<i32>::with_capacity(length);
        let mut n = 0i32;
        for word in words {
            idx.push(n);
            n += word.count_ones() as i32;
        }
        if trailing {
            idx.push(n)
        }
        idx
    }

    pub fn select_32_r64(
        words: &[u64],
        select_index: &[i32],
        rank_index: &[i32],
        i: i32,
    ) -> (i32, i32) {
        let mut a;
        let l = words.len() as i32;

        let mut word_l = select_index[(i >> 5) as usize] >> 6;
        while rank_index[(word_l + 1) as usize] <= i {
            word_l += 1;
        }

        let mut w = words[word_l as usize];
        let mut ww = w;
        let base = word_l << 6;
        let mut find_ith = (i - rank_index[word_l as usize]) as isize;

        let mut offset = 0i32;

        let mut ones = (ww as u32).count_ones() as isize;
        if ones <= find_ith {
            find_ith -= ones;
            offset |= 32;
            ww >>= 32;
        }

        ones = (ww as u16).count_ones() as isize;
        if ones <= find_ith {
            find_ith -= ones;
            offset |= 16;
            ww >>= 16;
        }

        ones = (ww as u8).count_ones() as isize;
        if ones <= find_ith {
            a = SELECT_8_LOOKUP[((ww >> 5) & 0x7f8 | (find_ith - ones) as u64) as usize] as i32
                + offset
                + 8;
        } else {
            a = SELECT_8_LOOKUP[(((ww & 0xff) << 3) | (find_ith) as u64) as usize] as i32 + offset;
        }

        a += base;

        // "& 63" eliminates boundary check
        w &= RMASK_UPTO[(a & 63) as usize];

        if w != 0 {
            return (a, base + w.trailing_zeros() as i32);
        }

        word_l += 1;
        while word_l < l {
            w = words[word_l as usize];
            if w != 0 {
                return (a, (word_l << 6) + w.trailing_zeros() as i32);
            }
            word_l += 1;
        }
        (a, l << 6)
    }

    pub fn rank_64(words: &[u64], r_index: &[i32], i: i32) -> (i32, i32) {
        let word_l = i >> 6;
        let j = (i & 63) as u32;

        let n = r_index[word_l as usize];
        let w = words[word_l as usize];

        let c1 = n + (w & MASK[j as usize]).count_ones() as i32;

        (c1, (w >> (j as usize)) as i32 & 1)
    }
}
