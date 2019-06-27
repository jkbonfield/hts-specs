# Some local opts for ease of my own testing

#CBIN=/nfs/users/nfs_j/jkb/work/htscodecs/build/tests
#NODE=/nfs/sam_scratch/jkb/opt/node-v10.15.1-linux-x64/bin/node

CBIN=../tests
NODE=node
NODE_OPTS=--use-strict

TESTS=test_r4x8 test_r4x16 test_arith test_fqzcomp
test check: htscodecs-corpus ${TESTS}

htscodecs-corpus:
	git clone https://github.com/jkbonfield/htscodecs.git

test_r4x8:
	@echo
	@echo === Checking r4x8
	@if [ ! -e ${CBIN}/rans4x8 ]; then echo "Set CBIN if you wish to validate against C version"; fi
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
	    if [ -e ${CBIN}/rans4x8 ]; \
	    then \
	      a=`${CBIN}/rans4x8 -d < _ 2>/dev/null | tr '\000' '\012' | md5sum`; \
	      test "$$a" = "$$b" || echo $<: Fail JS to C round-trip for $$base; \
	    fi; \
	done

test_r4x16:
	@echo
	@echo === Checking r4x16
	@if [ ! -e ${CBIN}/rans4x16pr ]; then echo "Set CBIN if you wish to validate against C version"; fi
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
	    if [ -e ${CBIN}/rans4x16pr ]; \
	    then \
	      a=`${CBIN}/rans4x16pr -d < _ 2>/dev/null | tr '\000' '\012' | md5sum`; \
	      test "$$a" = "$$b" || echo $<: Fail JS to C round-trip for $$base; \
	    fi; \
	done

test_arith:
	@echo
	@echo === Checking arith
	@if [ ! -e ${CBIN}/arith_dynamic ]; then echo "Set CBIN if you wish to validate against C version"; fi
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
	    if [ -e ${CBIN}/arith_dynamic ]; \
	    then \
	      a=`${CBIN}/arith_dynamic -d < _ 2>/dev/null | tr '\000' '\012' | md5sum`; \
	      test "$$a" = "$$b" || echo $<: Fail JS to C round-trip for $$base; \
	    fi; \
	done

test_fqzcomp:
	@echo
	@echo === Checking fqzcomp
	@if [ ! -e ${CBIN}/fqzcomp_qual ]; then echo "Set CBIN if you wish to validate against C version"; fi
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
	    if [ -e ${CBIN}/fqzcomp_qual ]; \
	    then \
	      a=`${CBIN}/fqzcomp_qual -d < _ 2>/dev/null | tr '\000' '\012' | md5sum`; \
	      test "$$a" = "$$b" || echo $<: Fail JS to C round-trip for $$base; \
	    fi; \
	done

test_tok3:
	@echo
	@echo === Checking tok3
	@if [ ! -e ${CBIN}/tokenise_name3 ]; then echo "Set CBIN if you wish to validate against C version"; fi
	@for base in htscodecs-corpus/names/*.names; do \
	    echo -n "$$base  	";\
	    ${NODE} ${NODE_OPTS} main_tok3.js -a $$base 2>/dev/null > _; \
	    a=`${NODE} ${NODE_OPTS} main_tok3 -d _ 2>/dev/null | md5sum`; \
	    cat _ | wc -c;\
	    b=`cat $$base | md5sum`; \
	    test "$$a" = "$$b" || echo $<: Fail round-trip for $$base; \
	    if [ -e ${CBIN}/tokenise_name3 ]; \
	    then \
	      a=`${CBIN}/tokenise_name3 -d < _ | tr '\000' '\012' | md5sum`; \
	      test "$$a" = "$$b" || echo $<: Fail JS to C round-trip for $$base; \
	    fi; \
	done;
	@for i in htscodecs-corpus/names/tok3/*; do \
	   echo $$i;\
	    base=`echo $$i | sed 's/\.[0-9]*$$//;s#/tok3##'`; \
	    level=`echo $$i | sed 's/.*\.//'`;\
	    # Decode predefined data set\
	    a=`${NODE} ${NODE_OPTS} main_tok3 -d $$i 2>/dev/null | md5sum`; \
	    b=`cat $$base | md5sum`; \
	    test "$$a" = "$$b" || echo $<: Mismatch for $$i; \
	done;
