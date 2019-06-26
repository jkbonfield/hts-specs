NODE=/nfs/sam_scratch/jkb/opt/node-v10.15.1-linux-x64/bin/node
NODE_OPTS=--use-strict

TESTS=test_r4x8 test_r4x16 test_arith test_fqzcomp
test check: htscodecs-corpus ${TESTS}

htscodecs-corpus:
	git clone https://github.com/jkbonfield/htscodecs.git

test_r4x8:
	@echo
	@echo === Checking r4x8
	@for i in htscodecs-corpus/dat/r4x8/*; do \
            echo $$i;\
	    base=`echo $$i | sed 's/\.[0-9]*$$//;s#/q#/../q#'`; \
	    level=`echo $$i | sed 's/.*\.//'`;\
	    # Decode predefined data set\
	    a=`${NODE} ${NODE_OPTS} main_rans.js -d $$i 2>/dev/null | md5sum`; \
	    b=`tr -d '\012' <  $$base | md5sum`; \
	    test "$$a" = "$$b" || echo $<: Mismatch for $$i; \
	    # Round trip. \
	    tr -d '\012' < $$base > _nonl; \
	    ${NODE} ${NODE_OPTS} main_rans.js -o $$level _nonl 2>/dev/null > _; \
	    a=`${NODE} ${NODE_OPTS} main_rans.js -d _ 2>/dev/null | md5sum`; \
	    test "$$a" = "$$b" || echo $<: Fail round-trip for $$base with level $$level; \
	done

test_r4x16:
	@echo
	@echo === Checking r4x16
	@for i in htscodecs-corpus/dat/r4x16/*; do \
            echo $$i;\
	    base=`echo $$i | sed 's/\.[0-9]*$$//;s#/q#/../q#'`; \
	    level=`echo $$i | sed 's/.*\.//'`;\
	    # Decode predefined data set\
	    a=`${NODE} ${NODE_OPTS} main_rans4x16.js -d $$i 2>/dev/null | md5sum`; \
	    b=`tr -d '\012' <  $$base | md5sum`; \
	    test "$$a" = "$$b" || echo $<: Mismatch for $$i; \
	    # Round trip. \
	    tr -d '\012' < $$base > _nonl; \
	    ${NODE} ${NODE_OPTS} main_rans4x16.js -o $$level _nonl 2>/dev/null > _; \
	    a=`${NODE} ${NODE_OPTS} main_rans4x16.js -d _ 2>/dev/null | md5sum`; \
	    test "$$a" = "$$b" || echo $<: Fail round-trip for $$base with level $$level; \
	done

test_arith:
	@echo
	@echo === Checking arith
	@for i in htscodecs-corpus/dat/arith/*; do \
            echo $$i;\
	    base=`echo $$i | sed 's/\.[0-9]*$$//;s#/q#/../q#'`; \
	    level=`echo $$i | sed 's/.*\.//'`;\
	    # Decode predefined data set\
	    a=`${NODE} ${NODE_OPTS} main_arith_gen.js -d $$i 2>/dev/null | md5sum`; \
	    b=`tr -d '\012' <  $$base | md5sum`; \
	    test "$$a" = "$$b" || echo $<: Mismatch for $$i; \
	    # Round trip. \
	    tr -d '\012' < $$base > _nonl; \
	    ${NODE} ${NODE_OPTS} main_arith_gen.js -o $$level _nonl 2>/dev/null > _; \
	    a=`${NODE} ${NODE_OPTS} main_arith_gen.js -d _ 2>/dev/null | md5sum`; \
	    test "$$a" = "$$b" || echo $<: Fail round-trip for $$base with level $$level; \
	done

test_fqzcomp:
	@echo
	@echo === Checking fqzcomp
	@for i in htscodecs-corpus/dat/fqzcomp/q*; do \
            echo $$i;\
	    base=`echo $$i | sed 's/\.[0-9]*$$//;s#/q#/../q#'`; \
	    level=`echo $$i | sed 's/.*\.//'`;\
	    # Decode predefined data set\
	    a=`${NODE} ${NODE_OPTS} main_fqzcomp.js -d $$i 2>/dev/null | md5sum`; \
	    b=`awk '{print $$1}' $$base | md5sum`; \
	    test "$$a" = "$$b" || echo $<: Mismatch for $$i; \
	    # Round trip. \
	    ${NODE} ${NODE_OPTS} main_fqzcomp.js -s $$level $$base 2>/dev/null > _; \
	    a=`${NODE} ${NODE_OPTS} main_fqzcomp -d _ 2>/dev/null | md5sum`; \
	    test "$$a" = "$$b" || echo $<: Fail round-trip for $$base with level $$level; \
	done

test_tok3:
	@echo
	@echo === Checking tok3
	@for i in htscodecs-corpus/names/tok3/*; do \
            echo $$i;\
	    base=`echo $$i | sed 's/\.[0-9]*$$//;s#/tok3##'`; \
	    level=`echo $$i | sed 's/.*\.//'`;\
	    # Decode predefined data set\
	    a=`${NODE} ${NODE_OPTS} main_tok3 -d $$i 2>/dev/null | md5sum`; \
	    b=`cat $$base | md5sum`; \
	    test "$$a" = "$$b" || echo $<: Mismatch for $$i; \
	done

#	    # Round trip. \
#	    ${NODE} ${NODE_OPTS} main_tok3.js -l $$level $$base 2>/dev/null > _; \
#	    a=`${NODE} ${NODE_OPTS} main_tok3 -d _ 2>/dev/null | md5sum`; \
#	    test "$$a" = "$$b" || echo $<: Fail round-trip for $$base with level $$level; \
