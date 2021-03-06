'use strict';

angular.module('habitrpg').factory('Payments',
['$rootScope', 'User', '$http', 'Content',
function($rootScope, User, $http, Content) {
  var Payments = {};
  var isAmazonReady = false;
  Payments.amazonButtonEnabled = true;

  Payments.paymentMethods = {
    AMAZON_PAYMENTS: 'Amazon Payments',
    STRIPE: 'Stripe',
    GOOGLE: 'Google',
    APPLE: 'Apple',
    PAYPAL: 'Paypal',
    GIFT: 'Gift'
  };

  Payments.paymentMethods = {
    AMAZON_PAYMENTS: 'Amazon Payments',
    STRIPE: 'Stripe',
    GOOGLE: 'Google',
    APPLE: 'Apple',
    PAYPAL: 'Paypal',
    GIFT: 'Gift'
  };

  window.onAmazonLoginReady = function(){
    isAmazonReady = true;
    amazon.Login.setClientId(window.env.AMAZON_PAYMENTS.CLIENT_ID);
  };

  Payments.showStripe = function(data) {
    var sub = false;

    if (data.subscription) {
      sub = data.subscription;
    } else if (data.gift && data.gift.type=='subscription') {
      sub = data.gift.subscription.key;
    }

    sub = sub && Content.subscriptionBlocks[sub];

    var amount = 500;// 500 = $5
    if (sub) amount = sub.price * 100;
    if (data.gift && data.gift.type=='gems') amount = data.gift.gems.amount / 4 * 100;
    if (data.group) amount = (sub.price + 3 * (data.group.memberCount - 1)) * 100;

    StripeCheckout.open({
      key: window.env.STRIPE_PUB_KEY,
      address: false,
      amount: amount,
      name: 'Habitica',
      description: sub ? window.env.t('subscribe') : window.env.t('checkout'),
      image: "/apple-touch-icon-144-precomposed.png",
      panelLabel: sub ? window.env.t('subscribe') : window.env.t('checkout'),
      token: function(res) {
        var url = '/stripe/checkout?a=a'; // just so I can concat &x=x below

        if (data.groupToCreate) {
          url = '/api/v3/groups/create-plan?a=a';
          res.groupToCreate = data.groupToCreate;
          res.paymentType = 'Stripe';
        }

        if (data.gift) url += '&gift=' + Payments.encodeGift(data.uuid, data.gift);
        if (data.subscription) url += '&sub='+sub.key;
        if (data.coupon) url += '&coupon='+data.coupon;
        if (data.groupId) url += '&groupId=' + data.groupId;
        $http.post(url, res).success(function(response) {
          if (response && response.data && response.data._id) {
            $rootScope.hardRedirect('/#/options/groups/guilds/' + response.data._id);
          } else {
            window.location.reload(true);
          }
        }).error(function(res) {
          alert(res.message);
        });
      }
    });
  }

  Payments.showStripeEdit = function(config) {
    var groupId;
    if (config && config.groupId) {
      groupId = config.groupId;
    }

    StripeCheckout.open({
      key: window.env.STRIPE_PUB_KEY,
      address: false,
      name: window.env.t('subUpdateTitle'),
      description: window.env.t('subUpdateDescription'),
      panelLabel: window.env.t('subUpdateCard'),
      token: function(data) {
        data.groupId = groupId;
        var url = '/stripe/subscribe/edit';
        $http.post(url, data).success(function() {
          window.location.reload(true);
        }).error(function(data) {
          alert(data.message);
        });
      }
    });
  }

  var amazonOnError = function(error){
    console.error(error);
    console.log(error.getErrorMessage(), error.getErrorCode());
    alert(error.getErrorMessage());
    Payments.amazonPayments.reset();
  };

  Payments.amazonPayments = {};

  Payments.amazonPayments.reset = function(){
    Payments.amazonPayments.modal.close();
    Payments.amazonPayments.modal = null;
    Payments.amazonPayments.type = null;
    Payments.amazonPayments.loggedIn = false;
    Payments.amazonPayments.gift = null;
    Payments.amazonPayments.billingAgreementId = null;
    Payments.amazonPayments.orderReferenceId = null;
    Payments.amazonPayments.paymentSelected = false;
    Payments.amazonPayments.recurringConsent = false;
    Payments.amazonPayments.subscription = null;
    Payments.amazonPayments.coupon = null;
  };

  // Needs to be called everytime the modal/router is accessed
  Payments.amazonPayments.init = function(data) {
    if(!isAmazonReady) return;
    if(data.type !== 'single' && data.type !== 'subscription') return;

    if (data.gift) {
      if(data.gift.gems && data.gift.gems.amount && data.gift.gems.amount <= 0) return;
      data.gift.uuid = data.giftedTo;
    }

    if (data.subscription) {
      Payments.amazonPayments.subscription = data.subscription;
      Payments.amazonPayments.coupon = data.coupon;
    }

    if (data.groupId) {
      Payments.amazonPayments.groupId = data.groupId;
    }

    if (data.groupToCreate) {
      Payments.amazonPayments.groupToCreate = data.groupToCreate;
    }

    Payments.amazonPayments.gift = data.gift;
    Payments.amazonPayments.type = data.type;

    var modal = Payments.amazonPayments.modal = $rootScope.openModal('amazonPayments', {
      // Allow the modal to be closed only by pressing cancel
      // because no easy method to intercept those types of closings
      // and we need to make some cleanup
      keyboard: false,
      backdrop: 'static'
    });

    modal.rendered.then(function(){
      OffAmazonPayments.Button('AmazonPayButton', window.env.AMAZON_PAYMENTS.SELLER_ID, {
        type:  'PwA',
        color: 'Gold',
        size:  'small',
        agreementType: 'BillingAgreement',

        onSignIn: function(contract){
          Payments.amazonPayments.billingAgreementId = contract.getAmazonBillingAgreementId();

          if (Payments.amazonPayments.type === 'subscription') {
            Payments.amazonPayments.loggedIn = true;
            Payments.amazonPayments.initWidgets();
          } else {
            var url = '/amazon/createOrderReferenceId'
            $http.post(url, {
              billingAgreementId: Payments.amazonPayments.billingAgreementId
            }).success(function(res){
              Payments.amazonPayments.loggedIn = true;
              Payments.amazonPayments.orderReferenceId = res.data.orderReferenceId;
              Payments.amazonPayments.initWidgets();
            }).error(function(res){
              alert(res.message);
            });
          }
        },

        authorization: function() {
          amazon.Login.authorize({
            scope: 'payments:widget',
            popup: true
          }, function(response) {
            if(response.error) return alert(response.error);

            var url = '/amazon/verifyAccessToken'
            $http.post(url, response).error(function(res){
              alert(res.message);
            });
          });
        },

        onError: amazonOnError
      });
    });

  }

  Payments.amazonPayments.canCheckout = function() {
    if (Payments.amazonPayments.type === 'single') {
      return Payments.amazonPayments.paymentSelected === true;
    } else if(Payments.amazonPayments.type === 'subscription') {
      return Payments.amazonPayments.paymentSelected === true &&
              // Mah.. one is a boolean the other a string...
              Payments.amazonPayments.recurringConsent === 'true';
    } else {
      return false;
    }
  }

  Payments.amazonPayments.initWidgets = function() {
    var walletParams = {
      sellerId: window.env.AMAZON_PAYMENTS.SELLER_ID,
      design: {
        designMode: 'responsive'
      },

      onPaymentSelect: function() {
        $rootScope.$apply(function() {
          Payments.amazonPayments.paymentSelected = true;
        });
      },

      onError: amazonOnError
    }

    if (Payments.amazonPayments.type === 'subscription') {
      walletParams.agreementType = 'BillingAgreement';
      console.log(Payments.amazonPayments.billingAgreementId);
      walletParams.billingAgreementId = Payments.amazonPayments.billingAgreementId;
      walletParams.onReady = function(billingAgreement) {
        Payments.amazonPayments.billingAgreementId = billingAgreement.getAmazonBillingAgreementId();

        new OffAmazonPayments.Widgets.Consent({
          sellerId: window.env.AMAZON_PAYMENTS.SELLER_ID,
          amazonBillingAgreementId: Payments.amazonPayments.billingAgreementId,
          design: {
            designMode: 'responsive'
          },

          onReady: function(consent){
            $rootScope.$apply(function(){
              var getConsent = consent.getConsentStatus
              Payments.amazonPayments.recurringConsent = getConsent ? getConsent() : false;
            });
          },

          onConsent: function(consent){
            $rootScope.$apply(function(){
              Payments.amazonPayments.recurringConsent = consent.getConsentStatus();
            });
          },

          onError: amazonOnError
        }).bind('AmazonPayRecurring');
      }
    } else {
      walletParams.amazonOrderReferenceId = Payments.amazonPayments.orderReferenceId;
    }

    new OffAmazonPayments.Widgets.Wallet(walletParams).bind('AmazonPayWallet');
  }

  Payments.amazonPayments.checkout = function() {
    Payments.amazonButtonEnabled = false;
    if (Payments.amazonPayments.type === 'single') {
      var url = '/amazon/checkout';
      $http.post(url, {
        orderReferenceId: Payments.amazonPayments.orderReferenceId,
        gift: Payments.amazonPayments.gift
      }).success(function(){
        Payments.amazonPayments.reset();
        window.location.reload(true);
      }).error(function(res){
        alert(res.message);
        Payments.amazonPayments.reset();
      });
    } else if(Payments.amazonPayments.type === 'subscription') {
      var url = '/amazon/subscribe';

      if (Payments.amazonPayments.groupToCreate) {
        url = '/api/v3/groups/create-plan';
      }

      $http.post(url, {
        billingAgreementId: Payments.amazonPayments.billingAgreementId,
        subscription: Payments.amazonPayments.subscription,
        coupon: Payments.amazonPayments.coupon,
        groupId: Payments.amazonPayments.groupId,
        groupToCreate: Payments.amazonPayments.groupToCreate,
        paymentType: 'Amazon',
      }).success(function(response) {
        Payments.amazonPayments.reset();
        if (response && response.data && response.data._id) {
          $rootScope.hardRedirect('/#/options/groups/guilds/' + response.data._id);
        } else {
          window.location.reload(true);
        }
      }).error(function(res){
        alert(res.message);
        Payments.amazonPayments.reset();
      });
    }
  }

  Payments.cancelSubscription = function(config) {
    if (config && config.group && !confirm(window.env.t('confirmCancelGroupPlan'))) return;
    if (!confirm(window.env.t('sureCancelSub'))) return;

    var group;
    if (config && config.group) {
      group = config.group;
    }

    var paymentMethod = User.user.purchased.plan.paymentMethod;
    if (group) {
      paymentMethod = group.purchased.plan.paymentMethod;
    }

    if (paymentMethod === 'Amazon Payments') {
      paymentMethod = 'amazon';
    } else {
      paymentMethod = paymentMethod.toLowerCase();
    }

    var cancelUrl = '/' + paymentMethod + '/subscribe/cancel?_id=' + User.user._id + '&apiToken=' + User.settings.auth.apiToken;
    if (group) {
      cancelUrl += '&groupId=' + group._id;
    }
    window.location.href = cancelUrl;
  }

  Payments.encodeGift = function(uuid, gift) {
    gift.uuid = uuid;
    var encodedString = JSON.stringify(gift);
    return encodeURIComponent(encodedString);
  }

  return Payments;
}]);
