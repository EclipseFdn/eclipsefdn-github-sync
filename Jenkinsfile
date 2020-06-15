@Library('common-shared') _

pipeline {
  agent {
    kubernetes {
      label 'kubedeploy-agent'
      yaml '''
      apiVersion: v1
      kind: Pod
      spec:
        containers:
        - name: kubectl
          image: eclipsefdn/kubectl:1.14-alpine
          command:
          - cat
          tty: true
      '''
    }
  }

  environment {
    NAMESPACE = 'foundation-internal-webdev-apps'
    IMAGE_NAME = 'eclipsefdn/eclipsefdn-github-sync'
    CRONJOB_NAME = 'eclipsefdn-github-sync'
    CONTAINER_NAME = 'eclipsefdn-github-sync'
    GL_IMAGE_NAME = 'eclipsefdn/eclipsefdn-gitlab-sync'
    GL_CRONJOB_NAME = 'eclipsefdn-gitlab-sync'
    GL_CONTAINER_NAME = 'eclipsefdn-gitlab-sync'
    TAG_NAME = sh(
      script: """
        GIT_COMMIT_SHORT=\$(git rev-parse --short ${env.GIT_COMMIT})
        printf \${GIT_COMMIT_SHORT}-${env.BUILD_NUMBER}
      """,
      returnStdout: true
    )
  }

  options {
    buildDiscarder(logRotator(numToKeepStr: '10'))
  }

  triggers { 
    // build once a week to keep up with parents images updates
    cron('H H * * H') 
  }

  stages {
    stage('Build docker image') {
      agent {
        label 'docker-build'
      }
      steps {
        sh '''
          docker build --pull -t ${IMAGE_NAME}:${TAG_NAME} -t ${IMAGE_NAME}:latest .
          docker build --pull -t ${GL_IMAGE_NAME}:${TAG_NAME} -t ${GL_IMAGE_NAME}:latest -f Dockerfile.gitlab .
        '''
      }
    }

    stage('Push docker image') {
      agent {
        label 'docker-build'
      }
      steps {
        withDockerRegistry([credentialsId: '04264967-fea0-40c2-bf60-09af5aeba60f', url: 'https://index.docker.io/v1/']) {
          sh '''
            docker push ${IMAGE_NAME}:${TAG_NAME}
            docker push ${IMAGE_NAME}:latest
            docker push ${GL_IMAGE_NAME}:${TAG_NAME}
            docker push ${GL_IMAGE_NAME}:latest
          '''
        }
      }
    }

    stage('Deploy to cluster') {
      when {
        branch 'master'
      }
      steps {
        container('kubectl') {
          withKubeConfig([credentialsId: '1d8095ea-7e9d-4e94-b799-6dadddfdd18a', serverUrl: 'https://console-int.c1-ci.eclipse.org']) {
            sh '''
              CRONJOB="$(kubectl get cronjob ${CRONJOB_NAME} -n "${NAMESPACE}" -o json)"
              if [[ $(echo "${CRONJOB}" | jq -r 'length') -eq 0 ]]; then
                echo "ERROR: Unable to find a cronjob to patch matching name '${CRONJOB_NAME}' in namespace ${NAMESPACE}"
                exit 1
              else 
                kubectl set image "cronjob.v1beta1.batch/${CRONJOB_NAME}" -n "${NAMESPACE}" "${CONTAINER_NAME}=${IMAGE_NAME}:${TAG_NAME}" --record=true
              fi
              
              GL_CRONJOB="$(kubectl get cronjob ${GL_CRONJOB_NAME} -n "${NAMESPACE}" -o json)"
              if [[ $(echo "${GL_CRONJOB}" | jq -r 'length') -eq 0 ]]; then
                echo "ERROR: Unable to find a cronjob to patch matching name '${GL_CRONJOB_NAME}' in namespace ${NAMESPACE}"
                exit 1
              else 
                kubectl set image "cronjob.v1beta1.batch/${GL_CRONJOB_NAME}" -n "${NAMESPACE}" "${GL_CONTAINER_NAME}=${GL_IMAGE_NAME}:${TAG_NAME}" --record=true
              fi
            '''
          }
        }
      }
    }
  }

  post {
    always {
      deleteDir() /* clean up workspace */
      sendNotifications currentBuild
    }
  }
}
